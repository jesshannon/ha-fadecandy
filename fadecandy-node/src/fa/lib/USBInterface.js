import debugLib from 'debug'
import usb from 'usb'
import { EventEmitter } from 'events'

const debug = debugLib('USBInterface')
const VENDOR_ID = 7504;
const PRODUCT_ID = 24698;

const events = {
    READY: 'ready',
    DETACHED: 'fadecandy_detached'
}

export default class USBInterface extends EventEmitter {

    constructor () {
        super()

        // usb >=2.x exposes hotplug events on the nested `usb` export
        const hotplug = usb.usb
        if (hotplug?.on) {
            hotplug.on('attach', (device) => this.__onDeviceAttach(device))
            hotplug.on('detach', (device) => this.__onDeviceDetach(device))
        } else {
            debug('Hotplug events not available on this platform/libusb build')
        }

        process.nextTick(()=>this.connect())
    }

    static get events () {
        return events;
    }

    connect () {
        this.__getDevice()
    }

    send (data, cb) {
        this.endpoint.transfer(data, (err) => this.__onTransferComplete(err, cb))
    }

    __onDeviceAttach (device) {
        if (
            device.deviceDescriptor.idVendor == VENDOR_ID &&
            device.deviceDescriptor.idProduct == PRODUCT_ID
        ) {

            debug('__onDeviceAttach: device is ours')

            this.device = device;
            this.__init()
        }
    }

    __onDeviceDetach(device) {
        debug('__onDeviceDetach')
        if (
            device.deviceDescriptor.idVendor == VENDOR_ID &&
            device.deviceDescriptor.idProduct == PRODUCT_ID
        ) {
            this.emit(events.DETACHED)
        }
    }

    __onTransferComplete (err, cb) {
        if (err) {
            console.log('endpoint transfer error', err)
            this.emit(events.TRANSFERERROR, err)
            return
        }

        if (cb) cb()

        debug('transfer complete')
    }

    __init () {
        this.endpoint = this.__getEndpoint()

        debug('has endpoint')

        this.emit(events.READY, this.endpoint)
    }

    __getDevice () {
        this.device = usb.findByIds(VENDOR_ID, PRODUCT_ID)

        debug('has device: ' + !this.device)

        if (this.device) this.__init()
    }

    __getEndpoint () {
        this.configDescriptor = this.device.configDescriptor

        this.device.open()

        let fci = this.device.interface(0)

        fci.claim()

        return fci.endpoint(1)
    }

}
