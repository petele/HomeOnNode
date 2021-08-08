"use strict";
var _a, _b;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BedJet = void 0;
const node_ble_1 = require("node-ble");
const { bluetooth, destroy } = node_ble_1.createBluetooth();
const events = require("events");
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
const IS_DEBUG = ((_a = process.env.DEBUG) === null || _a === void 0 ? void 0 : _a.includes('*')) ||
    ((_b = process.env.DEBUG) === null || _b === void 0 ? void 0 : _b.includes('BEDJET'));
debugLogger('START', 'BedJet created in DEBUG mode.');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function debugLogger(level, ...args) {
    if (!IS_DEBUG) {
        return;
    }
    console.log('[BedJet]', `_${level.toUpperCase()}_`, ...args);
}
var Buttons;
(function (Buttons) {
    Buttons["OFF"] = "OFF";
    Buttons["COOL"] = "COOL";
    Buttons["TURBO"] = "TURBO";
    Buttons["HEAT"] = "HEAT";
    Buttons["FAN_UP"] = "FAN_UP";
    Buttons["FAN_DOWN"] = "FAN_DOWN";
    Buttons["TEMP_UP"] = "TEMP_UP";
    Buttons["TEMP_DOWN"] = "TEMP_DOWN";
    Buttons["DRY"] = "DRY";
    Buttons["EXT_HEAT"] = "EXT_HEAT";
    Buttons["M1"] = "M1";
    Buttons["M2"] = "M2";
    Buttons["M3"] = "M3";
})(Buttons || (Buttons = {}));
const MODE_LOOKUP = ['off', 'heat', 'turbo', 'ext-heat', 'cool', 'dry'];
const FAN_SPEED_LOOKUP = [
    5, 10, 15, 20, 25, 30, 35, 40, 45, 50,
    55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
];
const BUTTON_INFO = {
    OFF: [0x01, 0x01],
    COOL: [0x01, 0x02],
    HEAT: [0x01, 0x03],
    TURBO: [0x01, 0x04],
    DRY: [0x01, 0x05],
    EXT_HEAT: [0x01, 0x06],
    FAN_UP: [0x01, 0x10],
    FAN_DOWN: [0x01, 0x11],
    TEMP_UP: [0x01, 0x12],
    TEMP_DOWN: [0x01, 0x13],
    M1: [0x01, 0x20],
    M2: [0x01, 0x21],
    M3: [0x01, 0x22],
};
const RETRY_DELAY = 1500;
class BedJet extends events.EventEmitter {
    constructor(address) {
        super();
        this._gattServer = null;
        this._isDestroyed = false;
        this._watchChar = null;
        this._address = address.toUpperCase();
        this._init();
    }
    async _init() {
        try {
            const adapter = await bluetooth.defaultAdapter();
            await adapter.startDiscovery();
            const bedJet = await adapter.waitDevice(this._address);
            await adapter.stopDiscovery();
            this._bedJet = bedJet;
        }
        catch (ex) {
            debugLogger('FATAL', '_init failed, module will not work!', ex);
            this.emit('error', ex);
        }
        if (!this._bedJet) {
            return;
        }
        const svcUUID = '00001000-bed0-0080-aa55-4265644a6574';
        await this.connect(3);
        this._model = await this._bedJet.getName();
        // Get the BedJet device name
        const charName = '00002001-bed0-0080-aa55-4265644a6574';
        const bjName = await this._getValue(svcUUID, charName);
        this._bjName = bjName.toString();
        // Get the BedJet device version (2005)
        const charVerA = '00002005-bed0-0080-aa55-4265644a6574';
        const verA = await this._getValue(svcUUID, charVerA);
        this._bjVersionA = verA.toString();
        // Get the BedJet device version (2006)
        const charVerB = '00002006-bed0-0080-aa55-4265644a6574';
        const verB = await this._getValue(svcUUID, charVerB);
        this._bjVersionB = verB.toString();
        await this.disconnect();
        this._bedJet.on('connect', this._onConnect.bind(this));
        this._bedJet.on('disconnect', this._onDisconnect.bind(this));
        debugLogger('INFO', 'ready');
        this.emit('ready');
    }
    async _onConnect() {
        debugLogger('INFO', 'connected');
        this.emit('connected', true);
    }
    async _onDisconnect() {
        debugLogger('INFO', 'disconnected');
        this._gattServer = null;
        this._watchChar = null;
        this.emit('connected', false);
    }
    get deviceInfo() {
        if (!this._bedJet) {
            return null;
        }
        return {
            model: this._model,
            name: this._bjName,
            version2005: this._bjVersionA,
            version2006: this._bjVersionB,
            address: this._address,
            rssi: null,
        };
    }
    async connect(numRetries) {
        const g2g = await this._isGoodToGo(false);
        if (!g2g.ready) {
            debugLogger('ERROR', 'connect', g2g.message);
            throw new Error(g2g.message);
        }
        const connected = await this._bedJet.isConnected();
        if (connected) {
            return true;
        }
        try {
            await this._bedJet.connect();
            return true;
        }
        catch (ex) {
            debugLogger('ERROR', 'connect', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.connect(numRetries - 1);
            }
        }
        return false;
    }
    async disconnect(numRetries) {
        const g2g = await this._isGoodToGo(false);
        if (!g2g.ready) {
            debugLogger('ERROR', 'disconnect', g2g.message);
            throw new Error(g2g.message);
        }
        const connected = await this._bedJet.isConnected();
        if (!connected) {
            return true;
        }
        try {
            await this.listenStop();
            await this._bedJet.disconnect();
            return true;
        }
        catch (ex) {
            debugLogger('ERROR', 'disconnect', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.disconnect(numRetries - 1);
            }
        }
        return false;
    }
    async sendButton(buttonName, numRetries) {
        const arr = BUTTON_INFO[buttonName];
        if (!arr) {
            throw new Error('unknown_button');
        }
        const svcUUID = '00001000-bed0-0080-aa55-4265644a6574';
        const charUUID = '00002004-bed0-0080-aa55-4265644a6574';
        const buff = Buffer.from(arr);
        try {
            await this._setValue(svcUUID, charUUID, buff);
        }
        catch (ex) {
            debugLogger('ERROR', 'sendButton', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.sendButton(buttonName, numRetries - 1);
            }
            throw ex;
        }
    }
    async setTimer(hours, minutes, numRetries) {
        if (minutes < 0 || minutes > 59 || hours < 0 || hours > 11) {
            throw new RangeError(`hours or minutes out of range (0-11, 0-59)`);
        }
        const svcUUID = '00001000-bed0-0080-aa55-4265644a6574';
        const charUUID = '00002004-bed0-0080-aa55-4265644a6574';
        const buff = Buffer.from([0x02, hours, minutes]);
        try {
            const result = await this._setValue(svcUUID, charUUID, buff);
            return result;
        }
        catch (ex) {
            debugLogger('ERROR', 'setTimer', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.setTimer(hours, minutes, numRetries - 1);
            }
            throw ex;
        }
    }
    async getState(numRetries) {
        const svcUUID = '00001000-bed0-0080-aa55-4265644a6574';
        const charUUID = '00002000-bed0-0080-aa55-4265644a6574';
        try {
            const char = await this._getCharacteristic(svcUUID, charUUID);
            return new Promise((resolve) => {
                char.once('valuechanged', (buff) => {
                    resolve(this._parseState(buff));
                    if (!this._watchChar) {
                        char.stopNotifications();
                    }
                });
                if (!this._watchChar) {
                    char.startNotifications();
                }
            });
        }
        catch (ex) {
            debugLogger('ERROR', 'getState', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.getState(numRetries - 1);
            }
            throw ex;
        }
    }
    async listenStart(numRetries) {
        const svcUUID = '00001000-bed0-0080-aa55-4265644a6574';
        const charUUID = '00002000-bed0-0080-aa55-4265644a6574';
        try {
            const char = await this._getCharacteristic(svcUUID, charUUID);
            this._watchChar = char;
            char.on('valuechanged', this._onListen.bind(this));
            char.startNotifications();
        }
        catch (ex) {
            debugLogger('ERROR', 'listenStart', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.listenStart(numRetries - 1);
            }
            throw ex;
        }
    }
    _onListen(buff) {
        this.emit('state', this._parseState(buff));
        debugLogger('STATE', `, ${new Date()}, ${Array.from(buff).toString()}`);
    }
    async listenStop(numRetries) {
        if (!this._watchChar) {
            return;
        }
        try {
            this._watchChar.off('valuechanged', this._onListen.bind(this));
            await this._watchChar.stopNotifications();
            this._watchChar = null;
        }
        catch (ex) {
            debugLogger('ERROR', 'listenStop', ex);
            if (numRetries && numRetries > 0) {
                await sleep(RETRY_DELAY);
                return await this.listenStop(numRetries - 1);
            }
            throw ex;
        }
    }
    _parseState(buff) {
        const buffAsArray = Array.from(buff);
        if (buff.length !== 20) {
            debugLogger('WARNING', `parseState - bad len on input buffer.`);
            return { raw: buffAsArray };
        }
        return {
            mode: MODE_LOOKUP[buff[9]],
            timeRemain: {
                hours: buff[4],
                minutes: buff[5],
                seconds: buff[6],
            },
            temperature: {
                set: buff[8] + 26,
                actual: buff[7] + 26,
            },
            fanSpeed: FAN_SPEED_LOOKUP[buff[10]],
            raw: buffAsArray,
        };
    }
    destroy() {
        debugLogger('INFO', 'destroy');
        destroy();
        this._isDestroyed = true;
        debugLogger('INFO', '!!destroyed!!');
    }
    async _isGoodToGo(mustBeConnected) {
        const result = {
            ready: true
        };
        if (this._isDestroyed) {
            debugLogger('ERROR', '_isGoodToGo', 'destroyed');
            result.ready = false;
            result.message = 'destroyed';
            return result;
        }
        if (!this._bedJet) {
            debugLogger('ERROR', '_isGoodToGo', 'no_bedjet');
            result.ready = false;
            result.message = 'no_bedjet';
            return result;
        }
        if (mustBeConnected) {
            const connected = await this._bedJet.isConnected();
            if (!connected) {
                debugLogger('ERROR', '_isGoodToGo', 'not_connected');
                result.ready = false;
                result.message = 'not_connected';
                return result;
            }
        }
        return result;
    }
    async _getGattServer() {
        const g2g = await this._isGoodToGo(true);
        if (!g2g.ready) {
            debugLogger('ERROR', '_getGattServer', g2g.message);
            throw new Error(g2g.message);
        }
        if (this._gattServer) {
            return this._gattServer;
        }
        this._gattServer = await this._bedJet.gatt();
        return this._gattServer;
    }
    async _getCharacteristic(svcUUID, charUUID) {
        const g2g = await this._isGoodToGo(true);
        if (!g2g.ready) {
            debugLogger('ERROR', '_getChar', g2g.message);
            throw new Error(g2g.message);
        }
        const gattServer = await this._getGattServer();
        const svc = await gattServer.getPrimaryService(svcUUID);
        const char = await svc.getCharacteristic(charUUID);
        return char;
    }
    async _setValue(svcUUID, charUUID, buff) {
        const g2g = await this._isGoodToGo(true);
        if (!g2g.ready) {
            debugLogger('ERROR', '_setValue', g2g.message);
            throw new Error(g2g.message);
        }
        const char = await this._getCharacteristic(svcUUID, charUUID);
        await char.writeValue(buff);
    }
    async _getValue(svcUUID, charUUID) {
        const g2g = await this._isGoodToGo(true);
        if (!g2g.ready) {
            debugLogger('ERROR', '_getValue', g2g.message);
            throw new Error(g2g.message);
        }
        const char = await this._getCharacteristic(svcUUID, charUUID);
        return await char.readValue();
    }
}
exports.BedJet = BedJet;
BedJet.Buttons = Buttons;
