const {contextBridge,ipcRenderer,webUtils}=require('electron');
const invoke=name=>(...args)=>ipcRenderer.invoke(name,...args);
contextBridge.exposeInMainWorld('ink',{
  dmBiliSearch:invoke('dm-bili-search'),
  dmSettings:invoke('dm-settings'),dmSaveSettings:invoke('dm-settings-save'),dmCancel:invoke('dm-cancel'),dmLoad:invoke('dm-load'),dmSearch:invoke('dm-search'),dmSelect:invoke('dm-select'),dmForgetFolder:invoke('dm-forget-folder'),dmImport:invoke('dm-import'),dmPick:invoke('dm-pick'),dmDocs:invoke('dm-docs'),
 isDesktop:true,pathForFile:f=>webUtils.getPathForFile(f),mediaUrl:p=>'ink://media/?p='+encodeURIComponent(p),
 pickVideo:invoke('pick-video'),probe:invoke('probe'),pickFiles:invoke('pick-files'),pickFolder:invoke('pick-folder'),listVideos:invoke('list-videos'),statPath:invoke('stat-path'),
 notesLoad:invoke('notes-load'),notesSave:invoke('notes-save'),renameVideo:invoke('rename-video'),
 projectsList:invoke('projects-list'),projectSave:invoke('project-save'),projectOpenFile:invoke('project-open-file'),projectRead:invoke('project-read'),projectRemove:invoke('project-remove'),
 pickDir:invoke('pick-dir'),defaultProjectDir:invoke('default-project-dir'),reveal:invoke('reveal'),
 exportBegin:invoke('export-begin'),exportImage:invoke('export-image'),exportRun:invoke('export-run'),exportCancel:invoke('export-cancel'),
 preparePreview:invoke('prepare-preview'),previewCancel:invoke('preview-cancel'),onPreviewProgress:cb=>ipcRenderer.on('preview-progress',(_,p)=>cb(p)),
 onExportProgress:cb=>ipcRenderer.on('export-progress',(_,p)=>cb(p)),onBeforeClose:cb=>ipcRenderer.on('before-close',cb),closeReady:()=>ipcRenderer.send('close-ready')
});
