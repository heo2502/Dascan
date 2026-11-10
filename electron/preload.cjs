const{contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('dascan',{layout:layouts=>ipcRenderer.send('layout-views',layouts),send:payload=>ipcRenderer.invoke('send-prompt',payload),reload:id=>ipcRenderer.send('reload-ai',id),onReady:callback=>ipcRenderer.on('ai-ready',(_event,id)=>callback(id))});
