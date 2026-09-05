"""Rasterize office documents for the ClearPage image pipeline.

DOCX and PPTX are rendered by a headless LibreOffice process because parsing
their XML is not sufficient to reproduce layout, fonts, charts, or images.
PDFs are rasterized with pdf2image and fall back to PyMuPDF when Poppler is not
installed. All public functions preserve page order.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from io import BytesIO
from pathlib import Path
from typing import BinaryIO, Sequence

SUPPORTED_EXTENSIONS = frozenset({".pdf", ".docx", ".pptx"})
DEFAULT_DPI = 300
DEFAULT_MAX_PAGES = 100
MAX_INPUT_BYTES = 100 * 1024 * 1024


class DocumentConversionError(RuntimeError):
    """Raised when a document cannot be rendered safely."""


def _validate_options(dpi: int, max_pages: int) -> None:
    if not isinstance(dpi, int) or not 72 <= dpi <= 600:
        raise ValueError("dpi must be an integer between 72 and 600")
    if not isinstance(max_pages, int) or not 1 <= max_pages <= 500:
        raise ValueError("max_pages must be an integer between 1 and 500")


def _extension(filename: str | Path | None) -> str:
    if filename is None:
        raise ValueError("filename is required when source is bytes")
    suffix = Path(filename).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        allowed = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise ValueError(f"unsupported document type; expected one of {allowed}")
    return suffix


def _read_source(
    source: str | Path | bytes | bytearray | BinaryIO,
    filename: str | Path | None,
) -> tuple[bytes | None, Path | None, str]:
    if isinstance(source, (str, Path)):
        path = Path(source)
        suffix = _extension(path)
        if not path.is_file():
            raise FileNotFoundError(f"document was not found: {path}")
        if path.stat().st_size > MAX_INPUT_BYTES:
            raise ValueError("document exceeds the 100 MB size limit")
        return None, path, suffix

    if hasattr(source, "read"):
        payload = source.read()
    else:
        payload = bytes(source)
    if len(payload) > MAX_INPUT_BYTES:
        raise ValueError("document exceeds the 100 MB size limit")
    return payload, None, _extension(filename)


def _write_input(payload: bytes, suffix: str, workspace: Path) -> Path:
    path = workspace / f"input{suffix}"
    path.write_bytes(payload)
    return path


def _libreoffice_binary() -> str:
    configured = os.getenv("LIBREOFFICE_BIN")
    if configured:
        if Path(configured).is_file():
            return configured
        raise DocumentConversionError("LIBREOFFICE_BIN does not point to an executable")
    for name in ("libreoffice", "soffice"):
        binary = shutil.which(name)
        if binary:
            return binary
    raise DocumentConversionError(
        "DOCX/PPTX conversion requires LibreOffice; install libreoffice or set LIBREOFFICE_BIN"
    )


def _office_to_pdf(source: Path, workspace: Path) -> Path:
    binary = _libreoffice_binary()
    profile = workspace / "lo-profile"
    profile.mkdir(exist_ok=True)
    command = [
        binary,
        "--headless",
        "--nologo",
        "--nodefault",
        "--nolockcheck",
        f"-env:UserInstallation={profile.as_uri()}",
        "--convert-to",
        "pdf",
        "--outdir",
        str(workspace),
        str(source),
    ]
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=180,
        )
    except subprocess.TimeoutExpired as exc:
        raise DocumentConversionError("LibreOffice timed out while converting the document") from exc
    except OSError as exc:
        raise DocumentConversionError(f"could not start LibreOffice: {exc}") from exc

    target = workspace / f"{source.stem}.pdf"
    if completed.returncode != 0 or not target.is_file():
        detail = (completed.stderr or completed.stdout or "conversion failed").strip()[-500:]
        raise DocumentConversionError(f"LibreOffice could not convert the document: {detail}")
    return target


def _pdf_page_count(path: Path) -> int | None:
    try:
        import fitz  # type: ignore

        document = fitz.open(path)
        try:
            return document.page_count
        finally:
            document.close()
    except ImportError:
        pass
    except Exception as exc:
        raise DocumentConversionError("the PDF is damaged or unsupported") from exc

    try:
        from pdf2image.pdfinfo import pdfinfo_from_path  # type: ignore

        return int(pdfinfo_from_path(str(path))["Pages"])
    except Exception:
        return None


def _render_pdf(path: Path, output_dir: Path, dpi: int, max_pages: int) -> list[Path]:
    count = _pdf_page_count(path)
    if count is not None and count > max_pages:
        raise ValueError(f"document has {count} pages; the limit is {max_pages}")

    rendered: list[Path] = []
    try:
        from pdf2image import convert_from_path  # type: ignore

        try:
            candidates = convert_from_path(
                str(path),
                dpi=dpi,
                fmt="png",
                output_folder=str(output_dir),
                output_file="rendered",
                paths_only=True,
                use_pdftocairo=True,
            )
        except TypeError:
            # Older pdf2image versions do not expose use_pdftocairo.
            candidates = convert_from_path(
                str(path),
                dpi=dpi,
                fmt="png",
                output_folder=str(output_dir),
                output_file="rendered",
                paths_only=True,
            )
        rendered = [Path(item) for item in candidates]
    except ImportError:
        rendered = []
    except Exception as exc:
        # A missing Poppler binary is recoverable through the PyMuPDF path.
        if not isinstance(exc, (FileNotFoundError, OSError)) and exc.__class__.__name__ not in {
            "PDFInfoNotInstalledError",
            "PDFPageCountError",
            "PDFSyntaxError",
        }:
            raise DocumentConversionError(f"PDF rasterization failed: {exc}") from exc

    if not rendered:
        try:
            import fitz  # type: ignore
        except ImportError as exc:
            raise DocumentConversionError(
                "PDF conversion requires pdf2image plus Poppler, or the PyMuPDF package"
            ) from exc
        try:
            document = fitz.open(path)
            try:
                if document.page_count > max_pages:
                    raise ValueError(
                        f"document has {document.page_count} pages; the limit is {max_pages}"
                    )
                scale = dpi / 72
                matrix = fitz.Matrix(scale, scale)
                for index, page in enumerate(document):
                    target = output_dir / f"rendered-{index:05d}.png"
                    page.get_pixmap(matrix=matrix, alpha=False).save(str(target))
                    rendered.append(target)
            finally:
                document.close()
        except ValueError:
            raise
        except Exception as exc:
            raise DocumentConversionError(f"PDF rasterization failed: {exc}") from exc

    if len(rendered) > max_pages:
        raise ValueError(f"document has {len(rendered)} pages; the limit is {max_pages}")

    # pdf2image names files according to its backend. Normalize names so the
    # downstream image pipeline has a stable, sortable page contract.
    output: list[Path] = []
    for index, source in enumerate(rendered, start=1):
        target = output_dir / f"page-{index:04d}.png"
        if source.resolve() != target.resolve():
            source.replace(target)
        output.append(target)
    return output


def convert_document_to_pngs(
    source: str | Path | bytes | bytearray | BinaryIO,
    *,
    filename: str | Path | None = None,
    output_dir: str | Path | None = None,
    dpi: int = DEFAULT_DPI,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[Path]:
    """Convert a PDF, DOCX, or PPTX into ordered high-resolution PNG paths.

    When ``output_dir`` is omitted, a new temporary workspace is created and
    remains on disk until the caller removes it. Use
    :func:`render_document_to_pngs` when byte arrays are preferred.
    """

    _validate_options(dpi, max_pages)
    payload, source_path, suffix = _read_source(source, filename)
    workspace = (
        Path(output_dir).expanduser()
        if output_dir is not None
        else Path(tempfile.mkdtemp(prefix="clearpage-doc-"))
    ).resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    input_path = source_path
    if payload is not None:
        input_path = _write_input(payload, suffix, workspace)
    assert input_path is not None

    pdf_path = input_path if suffix == ".pdf" else _office_to_pdf(input_path, workspace)
    if pdf_path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("converted PDF exceeds the 100 MB size limit")
    return _render_pdf(pdf_path, workspace, dpi, max_pages)


def render_document_to_pngs(
    source: str | Path | bytes | bytearray | BinaryIO,
    *,
    filename: str | Path | None = None,
    dpi: int = DEFAULT_DPI,
    max_pages: int = DEFAULT_MAX_PAGES,
) -> list[bytes]:
    """Return ordered PNG byte arrays and clean the intermediate workspace."""

    with tempfile.TemporaryDirectory(prefix="clearpage-doc-") as directory:
        paths = convert_document_to_pngs(
            source,
            filename=filename,
            output_dir=directory,
            dpi=dpi,
            max_pages=max_pages,
        )
        return [path.read_bytes() for path in paths]


def _image_for_pdf(image: bytes | bytearray | str | Path | object):
    try:
        from PIL import Image  # type: ignore
    except ImportError as exc:
        raise DocumentConversionError("PDF export requires Pillow") from exc

    if isinstance(image, (str, Path)):
        opened = Image.open(image)
    elif isinstance(image, (bytes, bytearray)):
        opened = Image.open(BytesIO(bytes(image)))
    elif isinstance(image, Image.Image):
        opened = image
    else:
        raise TypeError("images must be PNG bytes, file paths, or Pillow Images")
    # Copy before closing file-backed images and flatten transparency for PDF.
    converted = opened.convert("RGBA")
    if opened is not image and hasattr(opened, "close"):
        opened.close()
    background = Image.new("RGB", converted.size, "white")
    background.paste(converted, mask=converted.getchannel("A"))
    converted.close()
    return background


def images_to_pdf(
    images: Sequence[bytes | bytearray | str | Path | object],
    output_path: str | Path | None = None,
) -> bytes | Path:
    """Pack ordered PNG images into one PDF, returning bytes or the output path."""

    if not images:
        raise ValueError("at least one image is required")
    pages = []
    try:
        pages = [_image_for_pdf(image) for image in images]
        buffer = BytesIO()
        pages[0].save(buffer, format="PDF", save_all=True, append_images=pages[1:])
        payload = buffer.getvalue()
    finally:
        for page in pages:
            page.close()

    if output_path is None:
        return payload
    target = Path(output_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.tmp")
    temporary.write_bytes(payload)
    os.replace(temporary, target)
    return target


# Short aliases for callers integrating with an existing image pipeline.
parse_document = convert_document_to_pngs
pack_images_to_pdf = images_to_pdf
document_to_pngs = convert_document_to_pngs
parse_document_to_pngs = convert_document_to_pngs
pngs_to_pdf = images_to_pdf


__all__ = [
    "SUPPORTED_EXTENSIONS",
    "DocumentConversionError",
    "convert_document_to_pngs",
    "render_document_to_pngs",
    "images_to_pdf",
    "parse_document",
    "pack_images_to_pdf",
    "document_to_pngs",
    "parse_document_to_pngs",
    "pngs_to_pdf",
]
