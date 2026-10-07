# Mindset POS — Git-backed product images

Product images are no longer stored as base64 blobs in Neon.

## Architecture
- GitHub repository (`public/assets/menu/`) is the source of truth for product images.
- Neon stores only `menu_items.image_path` plus normal product metadata.
- POS reads the image path from Neon and serves the actual file from the deployed Git checkout.
- When Admin uploads/replaces an image, the server commits the image to GitHub through the GitHub Contents API, writes the same file locally, then saves the path in Neon.
- If Render is connected to the GitHub repository with auto-deploy, the commit triggers a new deploy and the image becomes part of the next build permanently.

## Required Render environment variables
Set these in Render → Environment:

```text
GITHUB_OWNER=Datnguyen834
GITHUB_REPO=mindset-pos
GITHUB_BRANCH=main
GITHUB_TOKEN=<GitHub fine-grained token>
```

The token only needs repository **Contents: Read and write** permission for this repository.

Never put the token in the source code or commit it to Git.
