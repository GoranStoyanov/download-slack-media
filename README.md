# download-slack-media (dsm.js)

This repository contains a small Node.js CLI script that extracts all image/video files from a Slack **standard export**:

- Reads a Slack export directory or `.zip` file.
- Copies any media files already present in the export.
- Scans all message JSON files for `url_private_download` / `url_private` links.
- Optionally downloads those media URLs using a Slack token (for files that are not embedded directly in the export).

The end result is a folder on disk with all the media it can find from your export.

---

## Requirements

- Node.js **18+** (for built‑in `fetch` support).
- `npm` for installing dependencies.
- A Slack **standard export** `.zip` or the unzipped export directory.
- (Optional but recommended) A Slack token with permission to read files (see below).

Install dependencies once:

```bash
npm install
```

This installs `adm-zip`, which is used to unpack `.zip` exports.

---

## Basic Usage

Run the script with Node:

```bash
node dsm.js <export_path> <output_dir> [--token <SLACK_TOKEN>]
```

Arguments:

- `<export_path>`  
  - Either a Slack export **directory** or the **`.zip`** file downloaded from Slack.
- `<output_dir>`  
  - Directory where results will be written.  
  - The script creates subfolders inside this directory.
- `--token <SLACK_TOKEN>` (optional but important)  
  - Slack token used to download media from `url_private` / `url_private_download` links.

You can also pass the token as `--token=YOUR_TOKEN`.

### What the script does

1. If `<export_path>` is a `.zip`, it extracts it to a temporary directory.
2. It recursively walks the export:
   - Records all `.json` files.
   - Records any files whose filename looks like an image or video (e.g. `.jpg`, `.png`, `.gif`, `.mp4`, `.mov`, etc.).
3. It copies all found media files directly from the export into:
   - `<output_dir>/exported_files/`
4. It parses every JSON file for messages with a `files` array and looks for:
   - `url_private_download` or `url_private`
   - Only keeps entries that are images or videos (by MIME type or filename).
5. If a `--token` is provided, it downloads each unique URL into:
   - `<output_dir>/downloaded_from_urls/`

If you do **not** provide `--token`, the script will:

- Still copy media found directly in the export.
- Skip downloading URL‑based media and log:

```text
[INFO] Media URLs found in JSON, but no --token provided. Skipping downloads.
```

---

## Example

Example command:

```bash
node dsm.js "<path-to-slack-export.zip>" ./output --token xoxp-your-user-oauth-token
```

After it runs, check:

- `./output/exported_files/` — media files that were already in the export.
- `./output/downloaded_from_urls/` — media files downloaded via Slack URLs using your token.

---

## Getting a Slack Export

To download a standard export (workspace owners/admins only):

1. In Slack, go to **Settings & administration → Workspace settings** (opens in the browser).
2. Go to **Import/Export Data → Export**.
3. Choose the date range and start the export.
4. When it’s ready, download the `.zip` file to your machine.

You can pass that `.zip` file directly as `<export_path>`, or unzip it first and pass the resulting directory.

---

## Slack Token: What It Is Used For

The script **only** uses your Slack token to perform authenticated HTTP `GET` requests directly to `url_private_download` / `url_private` file URLs found in the export JSON:

```http
GET <url_private_download> 
Authorization: Bearer <YOUR_TOKEN>
```

It does **not** call any other Slack Web API methods, nor does it post messages or modify data. However, the token itself may carry broader permissions within Slack, so you should treat it as sensitive and keep it secret.

---

## How to Get a Slack Token

There are several ways to obtain a token that can read files. The most current and supported way is to create a Slack app and install it to your workspace to obtain a **User OAuth Token**.

### 1. Create a Slack App

1. Visit `https://api.slack.com/apps`.
2. Click **Create New App → From scratch**.
3. Give it a name (e.g. `download-slack-media`) and choose your workspace.

### 2. Add OAuth Scopes

In your app configuration:

1. Go to **OAuth & Permissions**.
2. Under **Scopes → User Token Scopes**, add:
   - `files:read`
3. Save your changes.

`files:read` is the key scope that allows your token to download files from `url_private_download` / `url_private` links that your user has permission to see.

> Note: The token must belong to a user who has access to the channels/DMs from which the files came; Slack enforces normal access controls.

### 3. Install the App to Your Workspace

1. In the same app configuration, click **Install App to Workspace** (or **Reinstall to Workspace** if you’ve installed before).
2. Authorize the requested permissions.
3. After installation, you will see:
   - A **User OAuth Token** (often starting with `xoxp-` or similar).

Copy that token and keep it safe.

### 4. Use the Token with the Script

Run the script and pass the token with `--token`:

```bash
node dsm.js "<path-to-slack-export.zip>" ./output --token xoxp-your-user-oauth-token
```

or:

```bash
node dsm.js "<path-to-slack-export.zip>" ./output --token=xoxp-your-user-oauth-token
```

You can also set it in an environment variable and reference it:

```bash
export SLACK_TOKEN=xoxp-your-user-oauth-token
node dsm.js "<path-to-slack-export.zip>" ./output --token "$SLACK_TOKEN"
```

---

## Permissions Summary

Minimum suggested scope for the token:

- `files:read` (user token scope)

The script:

- Reads from the Slack export on disk.
- Uses the token only for HTTP `GET` requests to file URLs.
- Writes media files to your local `<output_dir>` in two subfolders:
  - `exported_files/`
  - `downloaded_from_urls/`

It does *not* upload anything back to Slack or other services.

---

## Notes and Tips

- If you see many `[DOWNLOAD-ERROR]` lines with HTTP 403/404, check:
  - That your token is valid and not expired.
  - That the token has `files:read`.
  - That the user associated with the token can access the channels/DMs where those files were shared.
- For huge exports, downloading all media can take time; you can re‑run the script on the same `<output_dir>` and it will simply overwrite files with the same names.
- If you only want the media already embedded in the export (no additional downloads), omit the `--token` argument.
