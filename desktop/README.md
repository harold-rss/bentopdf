# BentoPDF desktop app

A standalone, offline program built from this repository's web app. It opens a PDF straight in the PDF Editor when you double-click the file, saves back to the same file, and never uses the network.

## Getting the Windows installer

The **Desktop app (Windows installer)** workflow builds it. Open the repository's **Actions** tab, pick the latest successful run of that workflow, and download the **BentoPDF-Windows-Installer** artifact (a zip containing `BentoPDF-Setup-<version>.exe`).

- The installer is not code-signed, so Windows SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**.
- It installs for the current user only and needs no administrator rights.
- To make it the default for PDFs: right-click any PDF, choose **Open with > Choose another app**, pick **BentoPDF**, and select **Always**.

## Using it

| Action | How |
| --- | --- |
| Open a PDF | Double-click it (once BentoPDF is the default), or **File > Open** (Ctrl+O) |
| Add an image | **Insert > Image**, click where it should go, then choose the image. Drag to move, drag a corner to resize |
| Sign | **Insert > Signatures** |
| Save to the same file | **File > Save** (Ctrl+S). A dot in the title bar means there are unsaved changes |
| Save a copy | **File > Save As** (Ctrl+Shift+S) |
| Merge, split, page numbers, OCR and the rest | **Tools > All Tools** (Ctrl+T). These save their result through a normal Save dialog |

Each PDF opens in its own window. Closing a window with unsaved changes asks whether to save.

## How it stays offline

- The app's files are read from disk through a private `app://` address. There is no web server and no open port.
- Every request that is not to the app itself is cancelled, the session runs in offline mode, and the pages carry the web app's Content Security Policy.
- The program is started with host-name resolution disabled and system proxies ignored, so the browser engine itself cannot connect anywhere. (The engine's spell-checker tries to fetch a dictionary from a Google server at start-up; that request cannot resolve and is switched off.)
- The page has no access to Node.js or the file system. It can only ask the shell to open a PDF, or to save to the file the user opened or chose.
- There is no auto-update, telemetry or crash reporting.

`test/e2e.cjs` checks all of this by running the real program with a network log and failing if any host name was resolved, any connection opened or any byte sent.

## Developing

Run these from the repository root unless noted.

```bash
npm install
```

```bash
npm run build
```

```bash
npm --prefix desktop install
```

```bash
npm --prefix desktop start
```

Tests need Playwright (`npm --prefix desktop install --no-save playwright`); on Linux run them under `xvfb-run -a`:

```bash
npm --prefix desktop test
```

To build the installer on a Windows machine:

```bash
npm --prefix desktop run dist:win
```
