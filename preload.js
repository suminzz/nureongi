// 화면(renderer)과 본체(main) 사이의 통로.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pet", {
  ignoreMouse: (v) => ipcRenderer.send("ignore-mouse", v),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  focus: () => ipcRenderer.send("focus"),
  busy: (v) => ipcRenderer.send("busy", v),
  menu: () => ipcRenderer.send("menu"),
  actionMenu: () => ipcRenderer.send("action-menu"),
  sprites: () => ipcRenderer.invoke("sprites"),
  chat: (text) => ipcRenderer.invoke("chat", text),
  onState: (cb) => ipcRenderer.on("pet-state", (_e, s) => cb(s)),
  onSay: (cb) => ipcRenderer.on("say", (_e, s) => cb(s)),
  onOpenChat: (cb) => ipcRenderer.on("open-chat", () => cb()),
});
