/// <reference types="node" />
import { GattCharacteristic, GattServer } from 'node-ble';
import events = require('events');
declare enum Buttons {
    OFF = "OFF",
    COOL = "COOL",
    TURBO = "TURBO",
    HEAT = "HEAT",
    FAN_UP = "FAN_UP",
    FAN_DOWN = "FAN_DOWN",
    TEMP_UP = "TEMP_UP",
    TEMP_DOWN = "TEMP_DOWN",
    DRY = "DRY",
    EXT_HEAT = "EXT_HEAT",
    M1 = "M1",
    M2 = "M2",
    M3 = "M3"
}
interface BedJetInfo {
    model: string;
    name: string;
    version2005: string;
    version2006: string;
    address: string;
    rssi: number | null;
}
interface BedJetState {
    mode?: string;
    timeRemain?: {
        hours: number;
        minutes: number;
        seconds: number;
    };
    temperature?: {
        set: number;
        actual: number;
    };
    fanSpeed?: number;
    raw: number[];
}
interface GoodToGo {
    ready: boolean;
    message?: string;
}
export declare class BedJet extends events.EventEmitter {
    readonly _address: string;
    private _bedJet;
    private _model;
    private _gattServer;
    private _bjName;
    private _bjVersionA;
    private _bjVersionB;
    private _isDestroyed;
    private _watchChar;
    static readonly Buttons: typeof Buttons;
    constructor(address: string);
    _init(): Promise<void>;
    _onConnect(): Promise<void>;
    _onDisconnect(): Promise<void>;
    get deviceInfo(): BedJetInfo | null;
    connect(numRetries?: number): Promise<boolean>;
    disconnect(numRetries?: number): Promise<boolean>;
    sendButton(buttonName: Buttons, numRetries?: number): Promise<void>;
    setTimer(hours: number, minutes: number, numRetries?: number): Promise<void>;
    getState(numRetries?: number): Promise<BedJetState>;
    listenStart(numRetries?: number): Promise<void>;
    _onListen(buff: Buffer): void;
    listenStop(numRetries?: number): Promise<void>;
    _parseState(buff: Buffer): BedJetState;
    destroy(): void;
    _isGoodToGo(mustBeConnected: boolean): Promise<GoodToGo>;
    _getGattServer(): Promise<GattServer>;
    _getCharacteristic(svcUUID: string, charUUID: string): Promise<GattCharacteristic>;
    _setValue(svcUUID: string, charUUID: string, buff: Buffer): Promise<void>;
    _getValue(svcUUID: string, charUUID: string): Promise<Buffer>;
}
export {};
