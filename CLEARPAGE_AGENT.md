# ClearPage AI agent

This workspace did not include the original `document-cleaner-mvp` checkout, so the agent integration is isolated under `backend/` and `frontend/` using the ClearPage API contract.

Start the API with:

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

Set `OPENAI_API_KEY` (and optionally `OPENAI_MODEL`) before submitting a command. The frontend proxies `/v1/*` to port 8000:

```bash
cd frontend
npm install
npm run dev
```

`POST /v1/agent/command` accepts `{ "text": "清除这张图的红笔字迹", "image_id": "optional-file-name", "page_ids": [0, 1] }`. Function Calling is constrained to exactly one of the registered `erase`, `reorder_pages`, or `optimize_layout` tools. Pydantic rejects unknown actions, targets, fields, invalid page permutations, and out-of-range regions before the local pipeline is called. `image_id` is resolved below `JOB_ROOT` (default `./data`) and path traversal is rejected. When `page_ids` is supplied, `reorder_pages` must contain every current page id exactly once and `optimize_layout.page_id` must refer to a current page.

Document conversion is available from `backend.document_parser`: use `render_document_to_pngs(...)` for ordered PNG bytes, `convert_document_to_pngs(...)` for ordered PNG paths, and `images_to_pdf(...)` to export the processed pages as one PDF. DOCX/PPTX require LibreOffice; PDF rendering uses `pdf2image`/Poppler with a PyMuPDF fallback.

On Debian/Ubuntu, install the system renderer with `sudo apt-get install libreoffice poppler-utils`. Set `LIBREOFFICE_BIN` when the executable is installed at a non-standard path.
