#!/usr/bin/env python3
"""One-time, resumable migration for legacy inspection report images.

The script reads the existing public configuration, backs up database rows and
PDF objects locally, converts base64 images to compact master/thumbnail files,
uploads them to the existing inspections bucket, verifies each upload, and only
then replaces the row state with lightweight object references.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import os
import re
import stat
import sys
import time
import uuid
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import requests
from PIL import Image, ImageOps


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.js"
BUCKET = "inspections"


def decode_rambled(label: str, source: str) -> str:
    match = re.search(rf"\b{re.escape(label)}:\s*'([0-9.]+)'", source)
    if not match:
        raise RuntimeError(f"Could not read {label} from config.js")
    return "".join(chr(int(n) - 13) for n in match.group(1).split("."))


def config() -> tuple[str, str]:
    source = CONFIG_PATH.read_text(encoding="utf-8")
    return decode_rambled("url", source).rstrip("/"), decode_rambled("key", source)


def object_path(path: str) -> str:
    return "/".join(quote(part, safe="") for part in path.split("/"))


class Supabase:
    def __init__(self, url: str, key: str):
        self.url = url
        self.headers = {"apikey": key}
        self.session = requests.Session()

    def request(self, method: str, url: str, **kwargs) -> requests.Response:
        headers = dict(self.headers)
        headers.update(kwargs.pop("headers", {}))
        response = self.session.request(method, url, headers=headers, timeout=120, **kwargs)
        response.raise_for_status()
        return response

    def rows(self) -> list[dict]:
        params = {
            "select": "id,created_at,report_number,pdf_path",
            "order": "created_at.asc",
        }
        return self.request("GET", f"{self.url}/rest/v1/inspection_reports", params=params).json()

    def full_row(self, row_id: str) -> dict:
        params = {"id": f"eq.{row_id}", "select": "*", "limit": "1"}
        rows = self.request("GET", f"{self.url}/rest/v1/inspection_reports", params=params).json()
        if not rows:
            raise RuntimeError(f"Inspection row {row_id} no longer exists")
        return rows[0]

    def patch_state(self, row_id: str, state_value: dict) -> None:
        params = {"id": f"eq.{row_id}"}
        self.request(
            "PATCH",
            f"{self.url}/rest/v1/inspection_reports",
            params=params,
            headers={"Content-Type": "application/json", "Prefer": "return=minimal"},
            data=json.dumps({"state": state_value}, separators=(",", ":")),
        )

    def public_get(self, path: str) -> bytes:
        url = f"{self.url}/storage/v1/object/public/{BUCKET}/{object_path(path)}"
        return self.request("GET", url).content

    def upload(self, path: str, data: bytes, content_type: str) -> None:
        url = f"{self.url}/storage/v1/object/{BUCKET}/{object_path(path)}"
        self.request(
            "POST",
            url,
            headers={"Content-Type": content_type, "x-upsert": "true", "Cache-Control": "31536000"},
            data=data,
        )

    def delete(self, path: str) -> None:
        url = f"{self.url}/storage/v1/object/{BUCKET}/{object_path(path)}"
        response = self.session.delete(url, headers=self.headers, timeout=120)
        if response.status_code not in (200, 204, 404):
            response.raise_for_status()

    def list_root(self) -> list[dict]:
        output: list[dict] = []
        offset = 0
        while True:
            body = {"prefix": "", "limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}}
            page = self.request(
                "POST",
                f"{self.url}/storage/v1/object/list/{BUCKET}",
                headers={"Content-Type": "application/json"},
                data=json.dumps(body),
            ).json()
            output.extend(page)
            if len(page) < 1000:
                break
            offset += len(page)
        return output


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_bytes(data)
    temp.replace(path)


def image_variant(source: bytes, max_dim: int, quality: int) -> tuple[bytes, int, int]:
    with Image.open(io.BytesIO(source)) as loaded:
        image = ImageOps.exif_transpose(loaded).convert("RGB")
        image.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, "JPEG", quality=quality, optimize=True, progressive=True)
        return output.getvalue(), image.width, image.height


def decode_data_url(value: str) -> bytes:
    if not value.startswith("data:") or "," not in value:
        raise ValueError("Not a data URL")
    return base64.b64decode(value.split(",", 1)[1], validate=False)


def backup_all(sb: Supabase, backup: Path, rows: list[dict]) -> list[dict]:
    backup.mkdir(parents=True, exist_ok=True)
    os.chmod(backup, stat.S_IRWXU)
    row_dir = backup / "rows"
    pdf_dir = backup / "pdfs"
    row_dir.mkdir(exist_ok=True)
    pdf_dir.mkdir(exist_ok=True)
    full_rows = []
    for index, summary in enumerate(rows, 1):
        row = sb.full_row(summary["id"])
        full_rows.append(row)
        atomic_write(row_dir / f"{row['id']}.json", json.dumps(row, ensure_ascii=False).encode("utf-8"))
        print(f"backup row {index}/{len(rows)}")

    objects = [item for item in sb.list_root() if str(item.get("name", "")).lower().endswith(".pdf")]
    manifest = {"created_at": datetime.now().astimezone().isoformat(), "rows": [], "pdfs": []}
    for row in full_rows:
        manifest["rows"].append({
            "id": row.get("id"),
            "report_number": row.get("report_number"),
            "pdf_path": row.get("pdf_path"),
            "state_bytes": len(json.dumps(row.get("state"), separators=(",", ":")).encode("utf-8")),
        })
    for index, item in enumerate(objects, 1):
        name = item["name"]
        data = sb.public_get(name)
        atomic_write(pdf_dir / name, data)
        manifest["pdfs"].append({"path": name, "bytes": len(data), "sha256": sha256(data)})
        print(f"backup PDF {index}/{len(objects)}")
    atomic_write(backup / "manifest-before.json", json.dumps(manifest, indent=2).encode("utf-8"))
    return full_rows


def migrate_rows(sb: Supabase, backup: Path, full_rows: list[dict]) -> dict:
    result = {"rows_migrated": 0, "images_migrated": 0, "source_bytes": 0, "master_bytes": 0, "thumb_bytes": 0, "rows": []}
    for row_index, row in enumerate(full_rows, 1):
        state_value = row.get("state")
        if not isinstance(state_value, dict):
            continue
        images = state_value.get("images")
        if not isinstance(images, list) or not any(isinstance(img, dict) and img.get("dataUrl") for img in images):
            continue
        folder = state_value.get("assetFolder") or str(uuid.uuid4())
        state_value["assetFolder"] = folder
        migrated = []
        row_stats = {"id": row["id"], "report_number": row.get("report_number"), "images": 0, "source_bytes": 0, "master_bytes": 0, "thumb_bytes": 0}
        for image_index, item in enumerate(images, 1):
            if not isinstance(item, dict):
                continue
            if item.get("path") and not item.get("dataUrl"):
                migrated.append(item)
                continue
            source = decode_data_url(item.get("dataUrl", ""))
            image_id = item.get("id") or str(uuid.uuid4())
            root = f"images/{folder}/{image_id}"
            master_path = root + ".jpg"
            thumb_path = root + "-thumb.jpg"
            master, width, height = image_variant(source, 1024, 60)
            thumb, _, _ = image_variant(source, 320, 55)
            sb.upload(master_path, master, "image/jpeg")
            sb.upload(thumb_path, thumb, "image/jpeg")
            remote_master = sb.public_get(master_path)
            remote_thumb = sb.public_get(thumb_path)
            if sha256(remote_master) != sha256(master) or sha256(remote_thumb) != sha256(thumb):
                raise RuntimeError(f"Upload verification failed for row {row['id']} image {image_index}")
            migrated.append({
                "id": image_id,
                "path": master_path,
                "thumbPath": thumb_path,
                "caption": item.get("caption", ""),
                "width": width,
                "height": height,
                "bytes": len(master),
                "mime": "image/jpeg",
            })
            row_stats["images"] += 1
            row_stats["source_bytes"] += len(source)
            row_stats["master_bytes"] += len(master)
            row_stats["thumb_bytes"] += len(thumb)
            print(f"migrate row {row_index}/{len(full_rows)} image {image_index}/{len(images)}")
        state_value["images"] = migrated
        sb.patch_state(row["id"], state_value)
        verified = sb.full_row(row["id"]).get("state") or {}
        if any(isinstance(img, dict) and img.get("dataUrl") for img in verified.get("images", [])):
            raise RuntimeError(f"Database verification failed for row {row['id']}")
        result["rows_migrated"] += 1
        result["images_migrated"] += row_stats["images"]
        result["source_bytes"] += row_stats["source_bytes"]
        result["master_bytes"] += row_stats["master_bytes"]
        result["thumb_bytes"] += row_stats["thumb_bytes"]
        result["rows"].append(row_stats)
    atomic_write(backup / "migration-result.json", json.dumps(result, indent=2).encode("utf-8"))
    return result


def clean_orphan_pdfs(sb: Supabase, backup: Path) -> dict:
    rows = sb.rows()
    referenced = {row.get("pdf_path") for row in rows if row.get("pdf_path")}
    pdfs = [item["name"] for item in sb.list_root() if str(item.get("name", "")).lower().endswith(".pdf")]
    orphans = sorted(set(pdfs) - referenced)
    backup_pdf_dir = backup / "pdfs"
    removed = []
    for index, path in enumerate(orphans, 1):
        local = backup_pdf_dir / path
        if not local.exists():
            atomic_write(local, sb.public_get(path))
        before = local.read_bytes()
        remote = sb.public_get(path)
        if sha256(before) != sha256(remote):
            raise RuntimeError(f"Backup hash mismatch for {path}")
        sb.delete(path)
        removed.append({"path": path, "bytes": len(remote), "sha256": sha256(remote)})
        print(f"remove orphan PDF {index}/{len(orphans)}")
    result = {"removed_count": len(removed), "removed_bytes": sum(item["bytes"] for item in removed), "objects": removed}
    atomic_write(backup / "orphan-cleanup-result.json", json.dumps(result, indent=2).encode("utf-8"))
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("migrate", "cleanup"))
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    url, key = config()
    sb = Supabase(url, key)
    backup = args.backup or (Path.home() / "Documents" / "MyMechanicQLD Backups" / ("inspection-images-" + datetime.now().strftime("%Y%m%d-%H%M%S")))
    if args.mode == "migrate":
        rows = sb.rows()
        full_rows = backup_all(sb, backup, rows)
        result = migrate_rows(sb, backup, full_rows)
        print(json.dumps({"backup": str(backup), **{k: v for k, v in result.items() if k != "rows"}}, indent=2))
    else:
        if not backup.exists():
            raise RuntimeError("Backup directory does not exist")
        result = clean_orphan_pdfs(sb, backup)
        print(json.dumps({"backup": str(backup), **{k: v for k, v in result.items() if k != "objects"}}, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("Stopped", file=sys.stderr)
        raise SystemExit(130)
