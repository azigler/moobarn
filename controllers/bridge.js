const { spawn } = require('child_process')
const findProcess = require('find-process')
const pidusage = require('pidusage')

class BridgeController {
  async init ({
    server,
    bridgeTelnetPort,
    bridgeWebsocketPort
  }) {
    this.server = server
    this.bridgeTelnetPort = bridgeTelnetPort
    this.bridgeWebsocketPort = bridgeWebsocketPort
  }

  async start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting telnet <-> websocket bridge...')
    this.startAll()
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping telnet <-> websocket bridge...')
  }

  async isBridgeStarted (moo) {
    const info = this.server.barn.get(moo)
    if (info.bridgePid) {
      try {
        await pidusage(info.bridgePid)
        return true
      } catch {
        this.server.setMooInfo(moo, { bridgePid: null })
        return false
      }
    } else {
      return false
    }
  }

  async startBridge (moo) {
    const info = this.server.barn.get(moo)
    if (info) {
      if (!(await this.isBridgeStarted(moo)) && !info.disabled) {
        const msgInfo = info
        msgInfo.bridgePid = 1
        if (this.server.FLAG === 'verbose') { console.log(`[>] Starting ${moo} bridge... ${this.server.bridgeOnlineStatusMsg(msgInfo)}`) }
        this.spawnBridge(moo, info)
      } else if (!info.disabled) {
        console.log(this.server.thingAlreadyStartedError('bridge', moo))
      } else {
        console.log(this.server.mooDisabledError(moo))
      }
    } else {
      console.log(this.server.notFoundError(moo, 'moo'))
    }
  }

  startAll () {
    if (this.server.FLAG === 'verbose') console.log('[%] Starting all bridges...')
    this.server.barn.forEach((value, key) => {
      if ((!value || !value.bridgePid) && !value.disabled && value.bridgeWebSocketPort) {
        this.startBridge(key)
      }
    })
  }

  async stopBridge (moo) {
    if (this.server.barn.get(moo)) {
      if (await this.isBridgeStarted(moo)) {
        console.log(`[X] Stopping ${moo} bridge...`)
        this.killBridge(moo)
      } else {
        console.log(this.server.thingAlreadyStoppedError('bridge', moo))
      }
    } else {
      console.log(this.server.notFoundError(moo, 'moo'))
    }
  }

  stopAll () {
    console.log('[%] Stopping all bridges...')
    this.server.barn.forEach((value, key) => {
      if (value && value.pid && value.bridgeWebSocketPort) {
        this.stopBridge(key)
      }
    })
  }

  killBridge (moo) {
    const info = this.server.barn.get(moo)
    try {
      process.kill(info.bridgePid)
    } finally {
      this.server.setMooInfo(moo, { bridgePid: null })
    }
  }

  resurrect () {
    this.server.barn.forEach(async (value, key) => {
      if (value.bridgePid) {
        try {
          await pidusage(value.bridgePid)
        } catch (e) {
          console.log(`[^] Resurrecting ${key} bridge ${this.server.bridgeOnlineStatusMsg(value)}...`)
          this.spawnBridge(key, value)
        }
      }
    })
  }

  async spawnBridge (moo, info = {}) {
    const cmd = `node node_modules/@digibear/socket-bridge/socket-bridge.js --connect --websocket ${info.bridgeWebSocketPort} --telnet ${info.bridgeTelnetPort ? info.bridgeTelnetPort : info.mooArgs.port}`

    const child = spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' })

    let bridgePid = child.pid

    const arr = await this.findBridgeProcesses()
    arr.forEach(ele => {
      if (ele.cmd === cmd) {
        bridgePid = ele.pid
      }
    })

    this.server.setMooInfo(moo, {
      bridgePid
    })
  }

  async findBridgeProcesses (format = 'array') {
    const processes = await findProcess('name', 'node_modules/@digibear/socket-bridge/socket-bridge.js')
    if (format === 'array') {
      return processes
    } else if (format === 'pretty') {
      if (processes.length) {
        console.log(`\nFound bridge-related process${processes.length > 1 ? 'es' : ''}:`)
        processes.forEach((proc, i) => {
          console.log(`  ${i + 1}. ${proc.name} [${proc.pid}] ${proc.cmd}`)
        })
        console.log()
      } else {
        console.log('\n No bridge-related processes found\n')
      }
    }
  }

  listAllBridges () {
    let longest = 0
    this.server.barn.forEach((value, key) => {
      if (key.length > longest) {
        longest = key.length
      }
    })

    console.log()
    this.server.barn.forEach((value, key) => {
      if (value.bridgeWebSocketPort) {
        let padding = ''
        let goal = longest - key.length
        for (goal; goal > 0; goal--) {
          padding = padding + ' '
        }
        console.log(`${padding}${key} :: ${this.server.bridgeOnlineStatusMsg(value)}`)
      }
    })
    console.log()
  }
}

// factory
module.exports = new BridgeController()
