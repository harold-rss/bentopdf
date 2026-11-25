# Checking BentoPDF's privacy yourself on Windows

These checks use Windows' own tools, so they don't depend on any of BentoPDF's code. Use any or all of them.

The **BentoPDF-Windows-Test-Kit** download from the Actions tab has everything below in one folder: the installer, these scripts and a harmless sample contract.

## 1. Disposable sandbox (Windows 11/10 Pro, Enterprise or Education)

Windows Sandbox is a throw-away copy of Windows built into Windows. Internet stays on inside it, so BentoPDF could go online if it tried, and everything is deleted when you close the window.

1. Turn on Windows Sandbox once: Start → "Turn Windows features on or off" → tick **Windows Sandbox** → OK → restart.
2. Unzip the test kit so the files are in `C:\BentoPDF-Test` (the `.wsb` file expects exactly that folder).
3. Optional: put a copy of one of your own PDFs in that folder. The sample contract is used otherwise.
4. Double-click `BentoPDF-Sandbox.wsb`. The sandbox opens, installs BentoPDF, opens the PDF and starts watching.
5. Use BentoPDF as you normally would: edit, insert an image, sign, save, open Tools → All Tools and try a few. Then close BentoPDF.
6. Read the report in the PowerShell window. **PASS** means no connection to any other computer was seen.
7. Close the sandbox window. Everything in it is deleted.

Windows Home doesn't include Windows Sandbox; use option 2 instead.

## 2. Watch it on your own PC (any Windows edition)

1. Open PowerShell in the test-kit folder (in File Explorer: click the address bar, type `powershell`, press Enter).
2. Run:

   ```
   powershell -ExecutionPolicy Bypass -File .\Watch-BentoPDF.ps1 -Launch -PdfPath .\sample-contract.pdf
   ```

3. Use BentoPDF, close it, and read the report. It's also saved as `BentoPDF-network-report.txt` on your desktop.

The watcher checks twice a second, so a connection that opened and closed in under half a second could slip past it. Option 3 closes that gap.

## 3. Block it in Windows Firewall (permanent guarantee)

This makes Windows itself refuse all network traffic for BentoPDF, whatever the program tries. It stays in place when you update BentoPDF.

1. Right-click Start → **Terminal (Admin)** or **Windows PowerShell (Admin)**.
2. Go to the test-kit folder (`cd C:\BentoPDF-Test`) and run:

   ```
   powershell -ExecutionPolicy Bypass -File .\Block-BentoPDF-Network.ps1
   ```

3. To undo it later, run the same command with `-Remove` at the end.

You can see the rules in Windows Security → Firewall & network protection → Advanced settings → Outbound Rules, named "BentoPDF - block all network".

BentoPDF keeps working normally with the rules in place, because it never needs the network.
