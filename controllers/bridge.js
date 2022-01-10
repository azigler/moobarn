const child_process = require('child_process')
const findProcess = require('find-process')
const pidusage = require('pidusage')

class BridgeController {
  async init ({
    server
  }) {
    this.server = server
    this.procMap = new Map()
  }

  async start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting telnet <-> websocket bridge...')
    this.updatePids()
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping telnet <-> websocket bridge...')
  }

  async isBridgeStarted (moo) {
    const info = this.server.barn.get(moo)
    if (info.bridge.pid) {
      try {
        await pidusage(info.bridge.pid)
        return true
      } catch {
        const bridge = info.bridge
        bridge.pid = null
        this.server.setMooInfo(moo, { bridge })
        return false
      }
    } else {
      return false
    }
  }

  async startBridge (moo) {
    const info = this.server.barn.get(moo)
    let result
    if (info) {
      if (!(await this.isBridgeStarted(moo)) && !info.disabled && info.bridge.webSocketPort && info.bridge.telnetPort) {
        const msgInfo = info
        msgInfo.bridge.pid = 1
        result = `[>] Starting ${moo} bridge... ${this.server.bridgeOnlineStatusMsg(msgInfo)}`
        this.spawnBridge(moo, info)
        console.log(result)
        return result
      } else if (!info.disabled && info.bridge.webSocketPort && info.bridge.telnetPort) {
        result = this.server.thingAlreadyStartedError('bridge', moo)
        console.log(result)
        return result
      } else if (info.disabled && info.bridge.webSocketPort && info.bridge.telnetPort) {
        result = this.server.mooDisabledError(moo)
        console.log(result)
        return result
      }
    }
  }

  async startAll () {
    const result = '[%] Starting all bridges...'
    console.log(result)
    for (const [key, value] of this.server.barn.entries()) {
      if (!value.bridge.pid && !value.disabled && value.bridge.webSocketPort && value.bridge.telnetPort) {
        this.startBridge(key)
      }
    }
    this.updatePids()
    return result
  }

  async stopBridge (moo) {
    let result
    const info = this.server.barn.get(moo)
    if (info) {
      if (await this.isBridgeStarted(moo)) {
        result = `[X] Stopping ${moo} bridge...`
        console.log(result)
        this.killBridge(moo)
        return result
      } else {
        result = this.server.thingAlreadyStoppedError('bridge', moo)
        console.log(result)
        return result
      }
    }
  }

  async stopAll () {
    const result = '[%] Stopping all bridges...'
    console.log(result)
    for (const [key, value] of this.server.barn.entries()) {
      if (value.bridge.pid && value.bridge.webSocketPort && value.bridge.telnetPort) {
        await this.stopBridge(key)
      }
    }
    return result
  }

  killBridge (moo) {
    const info = this.server.barn.get(moo)
    try {
      process.kill(info.bridge.pid)
    } finally {
      const bridge = info.bridge
      bridge.pid = null
      this.server.setMooInfo(moo, { bridge })
    }
  }

  resurrect () {
    this.server.barn.forEach(async (value, key) => {
      if (value.bridge.pid) {
        try {
          await pidusage(value.bridge.pid)
        } catch (e) {
          console.log(`[^] Resurrecting ${key} bridge ${this.server.bridgeOnlineStatusMsg(value)}...`)
          this.spawnBridge(key, value)
        }
      }
    })
  }

  async spawnBridge (moo, info = {}) {
    const cmd = `node node_modules/@digibear/socket-bridge/socket-bridge.js --connect --websocket ${info.bridge.webSocketPort} --telnet ${info.bridge.telnetPort ? info.bridge.telnetPort : this.server.defaultMooPort}`

    const child = child_process.spawn(cmd, [], { shell: true, detached: true, stdio: 'ignore' })

    const bridgePid = child.pid

    const bridge = info.bridge
    bridge.pid = bridgePid
    this.server.setMooInfo(moo, { bridge })
  }

  updatePids () {
    setTimeout(async () => {
      const arr = await this.findBridgeProcesses()
      for (const [key, value] of this.procMap.entries()) {
        for (const ele of arr) {
          if (ele.cmd === value) {
            const bridge = value.bridge
            bridge.pid = ele.pid
            this.server.setMooInfo(key, { bridge })
          }
        }
      }
    }, 400)
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
      if (value.bridge.webSocketPort && value.bridge.telnetPort) {
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
