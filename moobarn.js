const fs = require('fs')
const path = require('path')
const pidusage = require('pidusage')

class Moobarn extends require('events') {
  constructor ({
    loopIntervalHours = process.env.LOOP_INTERVAL_HOURS || 1,
    defaultMooPort = process.env.DEFAULT_MOO_PORT || 7777,
    defaultBackupIntervalHours = process.env.DEFAULT_BACKUP_INTERVAL_HOURS || 24,
    defaultBackupFinalScript = process.env.DEFAULT_BACKUP_FINAL_SCRIPT || '',
    webHostname = (process.env.WEB_HOSTNAME && process.env.WEB_HOSTNAME !== '') ? process.env.WEB_HOSTNAME : 'localhost',
    webTlsCert = (process.env.WEB_TLS_CERT && process.env.WEB_TLS_CERT !== '') ? process.env.WEB_TLS_CERT : false,
    webTlsKey = (process.env.WEB_TLS_KEY && process.env.WEB_TLS_KEY !== '') ? process.env.WEB_TLS_KEY : false,
    webPort = process.env.WEB_PORT || 7987,
    webCookieUsername = process.env.WEB_COOKIE_USERNAME || 'moobarn',
    webCookiePassword = process.env.WEB_COOKIE_PASSWORD || 'moobarn-hapi-authentication-cookie',
    webCookieTtlDays = process.env.WEB_COOKIE_TTL_DAYS || 1,
    webLoginUsername = process.env.WEB_LOGIN_USERNAME || 'admin',
    webLoginPassword = process.env.WEB_LOGIN_PASSWORD || 'moobarn'
  } = {}) {
    super()
    this.defaultMooPort = defaultMooPort

    this.on('start', async () => {
      this.startTime = new Date()
      if (this.FLAG === 'verbose') console.log(`[%] Starting moobarn @ ${this.startTime}`)
      this.serverLoop = setInterval(this.loop.bind(this), loopIntervalHours * 1000 * 60 * 60)

      this.controllers.forEach(controller => {
        if (!controller.init) return
        controller.init({
          server: this,
          loopIntervalHours,
          defaultBackupIntervalHours,
          defaultBackupFinalScript,
          webHostname,
          webTlsCert,
          webTlsKey,
          webPort,
          webCookieUsername,
          webCookiePassword,
          webCookieTtlDays,
          webLoginUsername,
          webLoginPassword
        })
      })
    })

    this.on('stop', () => {
      this.stopTime = new Date()
      console.log(`[%] Stopping moobarn @ ${this.stopTime}`)
      clearTimeout(this.serverLoop)
      this.serverLoop = false
    })

    this.mooAlreadyExistsError = (moo) => `ERROR: ${moo} moo already exists`
    this.notFoundError = (name, type) => `ERROR: ${name} ${type} not found`
    this.thingAlreadyStartedError = (thing, moo) => `ERROR: ${moo} ${thing} has already started`
    this.thingAlreadyStoppedError = (thing, moo) => `ERROR: ${moo} ${thing} has already stopped`
    this.backupFailedError = (moo) => `ERROR: back up failed for ${moo} moo`
    this.mooDisabledError = (moo) => `ERROR: ${moo} moo is disabled`
    this.notFoundForError = (notFound, forThing) => `[!] No ${notFound} found for ${forThing}! Setting default...`
    this.invalidNameError = (name) => `ERROR: ${name} is an invalid name`

    this.mooOnlineStatusMsg = (info, starting = false) => {
      const hostname = info.mooArgs.ipv4 ? info.mooArgs.ipv4 + ' ' : ''
      const port = info.mooArgs.ports ? info.mooArgs.ports[0] : this.defaultMooPort
      const tlsPort = info.mooArgs.tlsPorts ? info.mooArgs.tlsPorts[0] : false

      if (tlsPort) {
        return `${starting || info.pid ? `🟢 ONLINE @ ${hostname}telnet port ${port} & TLS port ${tlsPort}` : '🔴 OFFLINE'}`
      } else {
        return `${starting || info.pid ? `🟢 ONLINE @ ${hostname}port ${port}` : '🔴 OFFLINE'}`
      }
    }

    this.bridgeOnlineStatusMsg = (info) => {
      // WSS -> TLS
      if (info.bridge.webSocketTlsCert && info.bridge.telnetTlsHostname) {
        return `${info.bridge.pid ? `🟢 ONLINE @ wss://${info.bridge.webSocketHostname}:${info.bridge.webSocketPort} -> ${info.bridge.telnetTlsHostname}:${info.bridge.telnetPort}` : '🔴 OFFLINE'}`
      }

      // WSS -> TELNET
      if (info.bridge.webSocketTlsCert && !info.bridge.telnetTlsHostname) {
        return `${info.bridge.pid ? `🟢 ONLINE @ wss://${info.bridge.webSocketHostname}:${info.bridge.webSocketPort} -> telnet ${info.bridge.telnetPort}` : '🔴 OFFLINE'}`
      }

      // WS -> TLS
      if (!info.bridge.webSocketTlsCert && info.bridge.telnetTlsHostname) {
        return `${info.bridge.pid ? `🟢 ONLINE @ WS ${info.bridge.webSocketPort} -> ${info.bridge.telnetTlsHostname}:${info.bridge.telnetPort}` : '🔴 OFFLINE'}`
      }

      // WS -> TELNET
      if (!info.bridge.webSocketTlsCert && !info.bridge.telnetTlsHostname) {
        return `${info.bridge.pid ? `🟢 ONLINE @ WS ${info.bridge.webSocketPort} -> telnet ${info.bridge.telnetPort}` : '🔴 OFFLINE'}`
      }
    }

    this.controllers = new Map()
    this.barn = new Map()

    this.load()
  }

  loop () {
    this.emit('loop')
  }

  start (flag) {
    this.FLAG = flag
    this.load('barn')
    this.emit('start')
  }

  stop () {
    this.emit('stop')
  }

  mooExists (moo) {
    return fs.existsSync(path.join(__dirname, 'barn', moo))
  }

  dbExists (db) {
    return fs.existsSync(path.join(__dirname, 'dbs', db, `${db}.db`))
  }

  getDbs () {
    return fs.readdirSync(
      path.join(__dirname, 'dbs'), e => {
        throw e
      }
    ).filter(db => {
      return db !== '.DS_Store'
    })
  }

  getMoocode () {
    return fs.readdirSync(
      path.join(__dirname, 'moocode'), e => {
        throw e
      }
    ).filter(item => {
      if (item.endsWith('.moo')) {
        return true
      } else {
        return false
      }
    }).map(item => {
      return item.split('.moo')[0]
    })
  }

  invalidName (name) {
    switch (name) {
      case 'all': {
        return true
      }
    }
    return false
  }

  listAllMoos () {
    let longest = 0
    this.barn.forEach((value, key) => {
      if (key.length > longest) {
        longest = key.length
      }
    })

    console.log()
    this.barn.forEach((value, key) => {
      let padding = ''
      let goal = longest - key.length
      for (goal; goal > 0; goal--) {
        padding = padding + ' '
      }
      console.log(`${padding}${key} :: ${this.mooOnlineStatusMsg(value)}`)
    })
    console.log()
  }

  async printInfo (moo, list = false) {
    const result = this.barn.get(moo)
    if (result) {
      let usage = null
      if (result.pid) {
        try {
          usage = await pidusage(result.pid)
        } catch {
          this.setMooInfo(moo, { pid: null })
        }
      }

      console.log(`\n${moo} ${this.mooOnlineStatusMsg(result)}`)
      console.log(`   Disabled: ${result.disabled ? 'true' : 'false'}`)
      console.log(`      Ports: ${result.mooArgs.ports ? result.mooArgs.ports : '(default)'}`)
      console.log(`  TLS Ports: ${result.mooArgs.tlsPorts ? result.mooArgs.tlsPorts : '(none)'}`)
      console.log(`        PID: ${!result.pid ? '(none)' : result.pid}`)
      if (usage) {
        console.log(`     Uptime: ${this.controllers.get('process').determineUptime(usage)}`)
        console.log(`     Memory: ${this.controllers.get('process').determineMemory(usage)}`)
        console.log(`        CPU: ${this.controllers.get('process').determineProcessor(usage)}`)
      }
      if (result.bridge.webSocketPort && result.bridge.telnetPort) {
        console.log(`     Bridge: ${this.bridgeOnlineStatusMsg(result)}`)
        console.log(` Bridge PID: ${!result.bridge.pid ? '(none)' : result.bridge.pid}`)
      }
      console.log(` Last Start: ${!result.lastStart ? '(never)' : new Date(result.lastStart)}`)
      console.log(`Last Backup: ${!result.backup.last ? '(never)' : new Date(result.backup.last)}`)
    } else {
      return console.log(this.notFoundError(moo, 'moo'))
    }
  }

  async printAllInfo () {
    for (const [key] of this.barn.entries()) {
      await this.printInfo(key, true)
    }
    console.log()
  }

  initMoo (moo, fromDb) {
    let result

    if (!moo || this.invalidName(moo)) {
      result = this.invalidNameError(moo)
      console.log(result)
      return result
    }

    if (this.mooExists(moo)) {
      result = this.mooAlreadyExistsError(moo)
      console.log(result)
      return result
    }

    if (!this.dbExists(fromDb)) {
      result = this.notFoundError(fromDb, 'db')
      console.log(result)
      return result
    }

    fs.mkdirSync(path.join(__dirname, 'barn', moo, 'backup'), { recursive: true }, (e) => {
      throw e
    })

    this.setMooInfo(moo)

    try {
      fs.copyFileSync(path.join(__dirname, 'dbs', fromDb, `${fromDb}.db`), path.join(__dirname, 'barn', moo, `${moo}.source.db`), fs.constants.COPYFILE_EXCL)
    } catch {
      result = this.mooAlreadyExistsError(moo)
      console.log(result)
      return result
    }

    result = `Successfully initialized ${moo} from ${fromDb}`
    console.log(result)
    return result
  }

  loadMooInfo (moo) {
    try {
      return require(path.join(__dirname, 'barn', moo, 'info.json'))
    } catch {
      console.log(this.notFoundForError('info.json', `${moo} moo`))
      this.setMooInfo(moo)
    }
  }

  setMooInfo (moo, info, replace = false) {
    if (!info) {
      const initInfo = {
        backup: {
          finalScript: null,
          intervalHours: null,
          last: 0
        },
        bridge: {
          pid: null,
          telnetPort: null,
          telnetTlsHostname: null,
          webSocketPort: null,
          webSocketHostname: null,
          webSocketTlsCert: null,
          webSocketTlsKey: null
        },
        disabled: false,
        lastStart: 0,
        mooArgs: {
          emergencyMode: null,
          startScript: null,
          startLine: null,
          logFile: null,
          clearLastMove: null,
          waifType: null,
          outbound: null,
          ipv4: null,
          ipv6: null,
          tlsCert: null,
          tlsKey: null,
          fileDir: null,
          execDir: null,
          ports: null,
          tlsPorts: null
        },
        name: moo,
        pid: null
      }

      return fs.writeFileSync(path.join(__dirname, 'barn', moo, 'info.json'), JSON.stringify(initInfo, null, '\t'), e => {
        throw e
      })
    }

    let data

    if (replace) {
      data = info
    } else {
      data = this.loadMooInfo(moo)
    }

    this.barn.set(moo, { ...data, ...info })
    fs.writeFileSync(path.join(__dirname, 'barn', moo, 'info.json'), JSON.stringify({ ...data, ...info }, null, '\t'), e => {
      throw e
    })
  }

  load (type = null, dir = __dirname) {
    if (type === null) {
      this._loadType('controllers', dir)
    } else {
      this._loadType(type, dir)
    }
  }

  _loadType (type, dir) {
    if (fs.existsSync(path.join(dir, type))) {
      const files = fs.readdirSync(
        path.join(dir, type), e => {
          throw e
        }
      )

      if (files.length > 0) {
        for (let file of files) {
          if (file.endsWith('.js') || !file.includes('.')) {
            const filename = file = file.split('.')[0]

            let isDir = false
            try {
              isDir = fs.lstatSync(path.join(dir, type, file)).isDirectory()
            } catch {}

            file = `${file}${isDir ? '/' + 'index.js' : ''}`

            if (type === 'api') {
              if (this.FLAG === 'verbose') console.log(`[+] Loaded ${filename} <${type}> from ${path.join(dir, type)}`)
              const sourcePath = path.join(dir, type, file)
              this.controllers.get('web').api = [...this.controllers.get('web').api, require(sourcePath)(this)]
              continue
            }

            if (type === 'barn') {
              this.barn.set(filename, this.loadMooInfo(filename))
              if (this.FLAG === 'verbose') console.log(`[*] Loaded ${filename} <moo> from ${path.join(dir, type)}`)
              continue
            } else {
              this[type].set(filename, require(
                path.join(dir, type, file)
              ))
            }

            if (type === 'controllers') {
              if (this.controllers.get(filename).init) {
                this.on('start', this.controllers.get(filename).start.bind(this.controllers.get(filename)))
                this.on('stop', this.controllers.get(filename).stop.bind(this.controllers.get(filename)))
              }

              if (this.controllers.get(filename).loop) {
                this.on('loop', this.controllers.get(filename).loop.bind(this.controllers.get(filename)))
              }
            }

            if (this.FLAG === 'verbose') console.log(`[+] Loaded ${filename} <${type.substr(0, type.length - 1)}> from ${path.join(dir, type)}`)
          }
        }
      }
    } else {
      if (this.FLAG === 'verbose') console.log(`[?] No ${type} found in ${dir}/${type}`)
    }
  }
}

module.exports = Moobarn
