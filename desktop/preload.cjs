// Bridge between the page and the desktop shell. The page gets only these
// functions; it has no access to Node.js or to the file system.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
    /** The PDF this window was opened with, if any: { path, name, data }. */
    takeLaunchFile: () => ipcRenderer.invoke('desktop:take-launch-file'),
    /** Called when a PDF is opened in this window after start-up. */
    onOpenFile: (callback) => ipcRenderer.on('open-file', (_event, file) => callback(file)),
    /** Called for menu commands: 'save', 'save-as', 'home'. */
    onMenu: (callback) => ipcRenderer.on('menu', (_event, action) => callback(action)),
    /** Write bytes back to the file this window has open. */
    save: (data) => ipcRenderer.invoke('desktop:save', data),
    /** Ask where to save, then write. */
    saveAs: (data, suggestedName) => ipcRenderer.invoke('desktop:save-as', data, suggestedName),
    /** Tell the shell whether the open document has unsaved changes. */
    setDirty: (dirty) => ipcRenderer.send('desktop:set-dirty', !!dirty),
    /** Tell the shell the document was closed (back to the tool grid). */
    documentClosed: () => ipcRenderer.send('desktop:document-closed'),
    /** A save requested by the shell could not be carried out. */
    saveAbandoned: () => ipcRenderer.send('desktop:save-abandoned'),
    /**
     * The user picked or dropped this file into the editor: let the shell know
     * where it lives on disk, so Save can write back to it. The path is read
     * here, not supplied by the page.
     */
    adoptFile: (file) => {
        let filePath = '';
        try {
            filePath = webUtils.getPathForFile(file);
        } catch {
            /* not a file from disk */
        }
        if (filePath) ipcRenderer.send('desktop:adopt-file', filePath);
    },
    /** Show the Open dialog. */
    openDialog: () => ipcRenderer.send('desktop:open-dialog'),
});
