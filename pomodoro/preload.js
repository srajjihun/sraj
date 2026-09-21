'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),
  saveDurations: (durations) => ipcRenderer.invoke('save-durations', durations),

  hide: () => ipcRenderer.send('hide-window'),
  quit: () => ipcRenderer.send('quit-app'),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  flash: () => ipcRenderer.send('flash'),

  onAlwaysOnTopChanged: (cb) =>
    ipcRenderer.on('always-on-top-changed', (_e, flag) => cb(flag)),
});
