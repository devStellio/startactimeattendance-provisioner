import './style.css';
import { Adb, AdbDaemonTransport } from '@yume-chan/adb';
import { AdbDaemonWebUsbDeviceManager, AdbDaemonWebUsbDevice } from '@yume-chan/adb-daemon-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';

const CONFIG = {
  packageName: 'com.startac.timeatt',
  adminReceiver: 'com.startac.timeatt/.receivers.AdminReceiver',
  downloadUrl: 'https://www.googleapis.com/drive/v3/files/1DaXQtF4LpmVDYn4RePKF0tMGGGbhq1M7?alt=media&key=AIzaSyDllCtqeCr7f4Adv0D8Y-pz5RZ4sv5iPU4'
};
let manager: AdbDaemonWebUsbDeviceManager | undefined;
let device: AdbDaemonWebUsbDevice | undefined;
let adb: Adb | undefined;
const credentialStore = new AdbWebCredentialStore('TimeAttProvisioner');
const getEl = (id: string) => document.getElementById(id)!;

const elements = {
  connectionStatus: getEl('connection-status'),
  statusText: document.querySelector('#connection-status .text')!,
  btnConnect: getEl('btn-connect') as HTMLButtonElement,
  btnDisconnect: getEl('btn-disconnect') as HTMLButtonElement,
  deviceInfoSection: getEl('device-info-section'),
  appStatusSection: getEl('app-status-section'),
  installSection: getEl('install-section'),
  provisioningSection: getEl('provisioning-section'),
  btnDownloadApk: getEl('btn-download-apk') as HTMLAnchorElement,
  infoManufacturer: getEl('info-manufacturer'),
  infoModel: getEl('info-model'),
  infoAndroid: getEl('info-android'),
  infoSerial: getEl('info-serial'),
  appInstalled: getEl('app-installed'),
  appVersion: getEl('app-version'),
  appDeviceOwner: getEl('app-device-owner'),
  apkFile: getEl('apk-file') as HTMLInputElement,
  btnInstallApk: getEl('btn-install-apk') as HTMLButtonElement,
  installProgress: getEl('install-progress'),
  progressBar: document.querySelector('#install-progress .progress-bar') as HTMLElement,
  progressText: document.querySelector('#install-progress .progress-text')!,
  btnSetOwner: getEl('btn-set-owner') as HTMLButtonElement,
  btnRemoveOwner: getEl('btn-remove-owner') as HTMLButtonElement,
  btnUninstall: getEl('btn-uninstall') as HTMLButtonElement,
  btnReboot: getEl('btn-reboot') as HTMLButtonElement,
  logContainer: getEl('log-container'),
  btnClearLog: getEl('btn-clear-log') as HTMLButtonElement,
  notification: getEl('notification'),
  notificationMessage: getEl('notification-message'),
  notificationClose: getEl('notification-close')
};

function log(msg: string, type = 'info') {
  const t = new Date().toLocaleTimeString();
  const e = document.createElement('div');
  e.className = 'log-entry ' + type;
  e.innerHTML = '<span class="log-time">[' + t + ']</span>' + msg;
  elements.logContainer.appendChild(e);
  elements.logContainer.scrollTop = elements.logContainer.scrollHeight;
}

let notificationTimeout: number | undefined;
function notify(msg: string, type: 'error' | 'success' | 'warning' | 'info' = 'info', duration = 8000) {
  if (notificationTimeout) clearTimeout(notificationTimeout);
  elements.notification.className = 'notification ' + type;
  elements.notificationMessage.textContent = msg;
  elements.notification.classList.remove('hidden');
  if (duration > 0) {
    notificationTimeout = window.setTimeout(() => {
      elements.notification.classList.add('hidden');
    }, duration);
  }
}

function hideNotification() {
  elements.notification.classList.add('hidden');
  if (notificationTimeout) clearTimeout(notificationTimeout);
}

function setStatus(s: string, t: string) {
  elements.connectionStatus.className = 'status ' + s;
  elements.statusText.textContent = t;
  const c = s === 'connected';
  elements.btnConnect.disabled = c || s === 'connecting';
  elements.btnDisconnect.disabled = !c;
  elements.deviceInfoSection.classList.toggle('hidden', !c);
  elements.appStatusSection.classList.toggle('hidden', !c);
  elements.installSection.classList.toggle('hidden', !c);
  if (!c) {
    elements.provisioningSection.classList.add('hidden');
  }
}

function updateSectionsVisibility(appInstalled: boolean, isDeviceOwner: boolean = false) {
  elements.installSection.classList.toggle('hidden', appInstalled);
  elements.provisioningSection.classList.toggle('hidden', !appInstalled);
  // Ocultar botón "Establecer" si ya es Device Owner, mostrar "Quitar"
  elements.btnSetOwner.classList.toggle('hidden', isDeviceOwner);
  elements.btnRemoveOwner.classList.toggle('hidden', !isDeviceOwner);
  // Ocultar "Desinstalar" si es Device Owner (no se puede desinstalar)
  elements.btnUninstall.classList.toggle('hidden', isDeviceOwner);
}

async function sh(cmd: string) { if (!adb) throw new Error('No conectado'); return await adb.subprocess.noneProtocol.spawnWaitText(cmd); }

async function getDeviceInfo() {
  log('Obteniendo info...');
  try {
    const [m, mo, a, s] = await Promise.all([sh('getprop ro.product.manufacturer'), sh('getprop ro.product.model'), sh('getprop ro.build.version.release'), sh('getprop ro.serialno')]);
    elements.infoManufacturer.textContent = m.trim() || '-';
    elements.infoModel.textContent = mo.trim() || '-';
    elements.infoAndroid.textContent = a.trim() || '-';
    elements.infoSerial.textContent = s.trim() || '-';
    log('Info obtenida', 'success');
  } catch (e: any) { log('Error: ' + e.message, 'error'); }
}

async function getAppStatus() {
  log('Verificando app...');
  try {
    const p = await sh('pm list packages ' + CONFIG.packageName);
    const i = p.includes(CONFIG.packageName);
    elements.appInstalled.textContent = i ? 'Si' : 'No';
    (elements.appInstalled as HTMLElement).style.color = i ? 'var(--success)' : 'var(--danger)';
    let isOwner = false;
    if (i) {
      const d = await sh('dumpsys package ' + CONFIG.packageName);
      const mt = d.match(/versionName=([^\s]+)/);
      elements.appVersion.textContent = mt ? mt[1] : '-';
      // Usar dumpsys device_policy para detectar Device Owner
      const o = await sh('dumpsys device_policy');
      // Buscar si nuestro package es Device Owner
      isOwner = o.includes('Device Owner') && o.includes('package=' + CONFIG.packageName);
      elements.appDeviceOwner.textContent = isOwner ? 'Si' : 'No';
      (elements.appDeviceOwner as HTMLElement).style.color = isOwner ? 'var(--success)' : 'var(--warning)';
    } else {
      elements.appVersion.textContent = '-';
      elements.appDeviceOwner.textContent = '-';
    }
    updateSectionsVisibility(i, isOwner);
    log('Verificado', 'success');
  } catch (e: any) { log('Error: ' + e.message, 'error'); }
}

async function connect() {
  try {
    setStatus('connecting', 'Conectando...');
    log('Solicitando dispositivo...');
    manager = AdbDaemonWebUsbDeviceManager.BROWSER;
    if (!manager) throw new Error('WebUSB no soportado');
    device = await manager.requestDevice();
    if (!device) throw new Error('No seleccionado');
    log('Dispositivo: ' + device.name);
    const conn = await device.connect();
    log('USB OK, autenticando...');
    const transport = await AdbDaemonTransport.authenticate({ serial: device.serial, connection: conn, credentialStore });
    log('Autenticado', 'success');
    adb = new Adb(transport);
    log('Conectado: ' + adb.banner.product + ' - ' + adb.banner.model, 'success');
    setStatus('connected', 'Conectado: ' + device.name);
    adb.disconnected.then(() => { log('Desconectado', 'warning'); handleDisconnect(); });
    await getDeviceInfo();
    await getAppStatus();
  } catch (e: any) { log('Error: ' + e.message, 'error'); setStatus('disconnected', 'Desconectado'); device = undefined; adb = undefined; }
}

function handleDisconnect() { adb = undefined; device = undefined; setStatus('disconnected', 'Desconectado'); }
async function disconnect() { if (adb) try { await adb.close(); } catch {} handleDisconnect(); }

async function installApk(file: File) {
  if (!adb) return;
  log('Instalando: ' + file.name);
  elements.installProgress.classList.remove('hidden');
  elements.btnInstallApk.disabled = true;
  try {
    const rp = '/data/local/tmp/app.apk';
    const buf = await file.arrayBuffer();
    const data = new Uint8Array(buf);
    const total = data.length;
    let off = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (off >= total) { c.close(); return; } const ch = data.slice(off, Math.min(off + 65536, total)); c.enqueue(ch); off += ch.length; upProg(Math.floor((off / total) * 80)); } });
    log('Subiendo...');
    const sync = await adb.sync();
    await sync.write({ filename: rp, file: stream as any });
    await sync.dispose();
    upProg(85);
    log('Instalando...');
    const r = await sh('pm install -r ' + rp + ' 2>&1');
    const installSuccess = r.toLowerCase().includes('success');
    if (installSuccess) {
      log('Instalacion completada', 'success');
      notify('App instalada correctamente.', 'success');
    } else {
      log('Error en la instalacion', 'error');
      notify('Error al instalar la app. Verifica que el archivo APK sea valido.', 'error');
    }
    upProg(95); await sh('rm -f ' + rp); upProg(100);
    await getAppStatus();
  } catch (e: any) { log('Error: ' + e.message, 'error'); }
  finally { elements.btnInstallApk.disabled = false; setTimeout(() => { elements.installProgress.classList.add('hidden'); upProg(0); }, 2000); }
}

function upProg(p: number) { elements.progressBar.style.width = p + '%'; elements.progressText.textContent = p + '%'; }

async function setDeviceOwner() {
  if (!adb) return;
  log('Estableciendo modo kiosko...');
  try {
    const r = await sh('dpm set-device-owner ' + CONFIG.adminReceiver + ' 2>&1');
    if (r.includes('already some accounts')) {
      const msg = 'Hay cuentas en el dispositivo. Ve a Ajustes > Cuentas y elimina TODAS las cuentas (Google, Samsung, etc.) antes de continuar.';
      log('ERROR: ' + msg, 'error');
      notify(msg, 'error', 0);
    } else if (r.includes('Success') || r.includes('Active admin')) {
      log('Modo kiosko establecido correctamente', 'success');
      notify('Modo kiosko establecido correctamente.', 'success');
    } else {
      log('Error al establecer modo kiosko', 'error');
      notify('Error al establecer modo kiosko. El dispositivo puede no ser compatible o ya tener un administrador.', 'error');
    }
    await getAppStatus();
  } catch (e: any) {
    log('Error al procesar la solicitud', 'error');
    notify('Error al procesar la solicitud. Verifica la conexion USB.', 'error');
  }
}

async function removeDeviceOwner() {
  if (!adb) return;
  if (!confirm('¿Estás seguro de quitar el modo kiosko? El dispositivo dejará de estar administrado.')) return;
  log('Quitando modo kiosko...');
  try {
    // Usar broadcast a la app para quitar Device Owner (funciona en Samsung y otros dispositivos)
    const broadcastCmd = 'am broadcast -a ' + CONFIG.packageName + '.CLEAR_DEVICE_OWNER -n ' + CONFIG.packageName + '/.receivers.ClearDeviceOwnerReceiver 2>&1';
    log('Procesando...');
    await sh(broadcastCmd);

    // Esperar un momento para que la app procese el broadcast
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Verificar si se quitó correctamente
    await getAppStatus();

    // Revisar si sigue siendo Device Owner
    const o = await sh('dumpsys device_policy');
    const stillOwner = o.includes('Device Owner') && o.includes('package=' + CONFIG.packageName);

    if (!stillOwner) {
      log('Modo kiosko quitado correctamente', 'success');
      notify('Modo kiosko quitado correctamente.', 'success');
    } else {
      log('No se pudo quitar el modo kiosko. Verifica la version de la app.', 'warning');
      notify('No se pudo quitar el modo kiosko. Asegurate de tener la app actualizada.', 'warning');
    }
  } catch (e: any) {
    log('Error al procesar la solicitud', 'error');
    notify('Error al procesar la solicitud. Verifica la conexion USB.', 'error');
  }
}

async function uninstallApp() {
  if (!adb) return;
  if (!confirm('¿Estás seguro de desinstalar la app?')) return;
  log('Desinstalando...');
  try {
    const o = await sh('dpm list-owners 2>/dev/null || echo ""');
    if (o.includes(CONFIG.packageName)) await removeDeviceOwner();
    const r = await sh('pm uninstall ' + CONFIG.packageName + ' 2>&1');
    const uninstallSuccess = r.toLowerCase().includes('success');
    if (uninstallSuccess) {
      log('App desinstalada correctamente', 'success');
    } else {
      log('Error al desinstalar la app', 'error');
    }
    await getAppStatus();
  } catch (e: any) { log('Error al procesar la solicitud', 'error'); }
}

async function reboot() { if (!adb || !confirm('Reiniciar?')) return; log('Reiniciando...', 'warning'); try { await sh('reboot'); } catch {} }

elements.btnConnect.addEventListener('click', connect);
elements.btnDisconnect.addEventListener('click', disconnect);
elements.apkFile.addEventListener('change', () => { elements.btnInstallApk.disabled = !elements.apkFile.files?.length; });
elements.btnInstallApk.addEventListener('click', () => { const f = elements.apkFile.files?.[0]; if (f) installApk(f); });
elements.btnSetOwner.addEventListener('click', setDeviceOwner);
elements.btnRemoveOwner.addEventListener('click', removeDeviceOwner);
elements.btnUninstall.addEventListener('click', uninstallApp);
elements.btnReboot.addEventListener('click', reboot);
elements.btnClearLog.addEventListener('click', () => { elements.logContainer.innerHTML = ''; });
elements.notificationClose.addEventListener('click', hideNotification);
(navigator as any).usb?.addEventListener('disconnect', (e: any) => { if (device?.raw === e.device) { log('USB desconectado', 'warning'); handleDisconnect(); } });
// Configurar URL de descarga
elements.btnDownloadApk.href = CONFIG.downloadUrl;

// Modal de ayuda USB
const modalUsbHelp = getEl('modal-usb-help');
const btnHelpUsb = getEl('btn-help-usb');
const closeModal = () => modalUsbHelp.classList.add('hidden');
btnHelpUsb.addEventListener('click', () => modalUsbHelp.classList.remove('hidden'));
modalUsbHelp.querySelector('.modal-close')?.addEventListener('click', closeModal);
modalUsbHelp.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
modalUsbHelp.querySelector('.modal-overlay')?.addEventListener('click', closeModal);

// Ocultar loader y mostrar app
const loader = document.getElementById('loader');
const app = document.getElementById('app');
if (loader) loader.classList.add('hidden');
if (app) app.classList.add('loaded');
setTimeout(() => loader?.remove(), 300);

log('Startac Time Attendance Provisioner iniciado');
if (!(navigator as any).usb) { log('ERROR: WebUSB no soportado', 'error'); elements.btnConnect.disabled = true; }
