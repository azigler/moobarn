const fs = require('fs')
const path = require('path')
const child_process = require('child_process')
const findProcess = require('find-process')
const pidusage = require('pidusage')

class ProcessController {
  async init ({
    server
  }) {
    this.server = server
    this.procMap = new Map()
  }

  start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting moo process controller...')
    this.updatePids()
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping moo process controller...')
  }

  async isMooStarted (moo) {
    const info = this.server.barn.get(moo)
    if (info.pid) {
      try {
        await pidusage(info.pid)
        return true
      } catch {
        this.server.setMooInfo(moo, { pid: null })
        return false
      }
    } else {
      return false
    }
  }

  async startMoo (moo) {
    const info = this.server.barn.get(moo)
    let result
    if (info) {
      if (!(await this.isMooStarted(moo)) && !info.disabled) {
        const msgInfo = info
        result = `[>] Starting ${moo} moo ${this.server.mooOnlineStatusMsg(msgInfo, true)}...`
        this.spawnMoo(moo, info)
        console.log(result)
        return result
      } else if (!info.disabled) {
        result = this.server.thingAlreadyStartedError('moo', moo)
        console.log(result)
        return result
      } else {
        result = this.server.mooDisabledError(moo)
        console.log(result)
        return result
      }
    } else {
      result = this.server.notFoundError(moo, 'moo')
      console.log(result)
      return result
    }
  }

  async startAll () {
    const result = '[%] Starting all moos...'
    console.log(result)
    for (const [key, value] of this.server.barn.entries()) {
      if (!value.pid && !value.disabled) {
        this.startMoo(key)
      }
    }
    this.updatePids()
    return result
  }

  async stopMoo (moo) {
    let result
    const info = this.server.barn.get(moo)
    if (info) {
      if (await this.isMooStarted(moo)) {
        result = `[X] Stopping ${moo} moo...`
        console.log(result)
        this.killMoo(moo)
        return result
      } else {
        result = this.server.thingAlreadyStoppedError('moo', moo)
        console.log(result)
        return result
      }
    } else {
      result = this.server.notFoundError(moo, 'moo')
      console.log(result)
      return result
    }
  }

  async stopAll (restart = false) {
    const result = '[%] Stopping all moos...'
    console.log(result)
    for (const [key, value] of this.server.barn.entries()) {
      if (value && value.pid) {
        await this.stopMoo(key)
      }
    }
    return result
  }

  killMoo (moo) {
    const info = this.server.barn.get(moo)
    try {
      process.kill(info.pid)
    } finally {
      this.server.setMooInfo(moo, { pid: null })
    }
  }

  resurrect () {
    this.server.barn.forEach(async (value, key) => {
      if (value.pid) {
        try {
          await pidusage(value.pid)
        } catch (e) {
          console.log(`[^] Resurrecting ${key} moo ${this.server.mooOnlineStatusMsg(value)}...`)
          this.spawnMoo(key, value)
        }
      }
    })
  }

  spawnMoo (moo, info = {}) {
    const [mooArgs, portArgs] = this.prepareMooArgs(info)
    let startDb

    try {
      startDb = this.shuffleMooFiles(moo, 'db')
    } catch (e) {
      return console.log(e)
    }

    this.shuffleMooFiles(moo, 'log')

    const logStream = fs.createWriteStream(path.join(__dirname, '../', 'barn', moo, `${moo}.new.log`))
    logStream.on('open', () => {
      const barnPath = path.join(__dirname, '../', 'barn')
      const mooPath = path.join(__dirname, '../', 'toaststunt', 'build', 'moo')

      let stdio = [logStream, logStream, logStream]
      if (info.mooArgs.scriptFile) {
        console.log(`NOTE: Unable to write to ${moo}.new.log due to -f argument`)
        stdio = ['inherit', 'inherit', 'inherit']
      }

      const cmd = `${mooPath} ${mooArgs ? mooArgs + ' ' : ''}${barnPath}/${moo}/${startDb} ${barnPath}/${moo}/${moo}.new.db ${portArgs}`

      const child = child_process.spawn(cmd, [], { shell: true, detached: true, stdio })

      const pid = child.pid

      this.procMap.set(moo, cmd)

      this.server.setMooInfo(moo, {
        pid,
        lastStart: new Date().getTime()
      })
    })
  }

  updatePids () {
    setTimeout(async () => {
      const arr = await this.findMooProcesses()
      for (const [key, value] of this.procMap.entries()) {
        for (const ele of arr) {
          if (ele.cmd === value) {
            this.server.setMooInfo(key, {
              pid: ele.pid
            })
          }
        }
      }
    }, 400)
  }

  shuffleMooFiles (moo, filetype = 'db') {
    const fileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
    const newFileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`))
    const sourceFileExists = fs.existsSync(path.join(__dirname, '../', 'barn', moo, `${moo}.source.${filetype}`))

    if (!fileExists && !newFileExists && sourceFileExists) {
      if (filetype === 'db') return `${moo}.source.db`
    }

    if (fileExists && newFileExists) {
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.old.${filetype}`))
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
      if (filetype === 'db') return `${moo}.db`
    }

    if (!fileExists && newFileExists) {
      fs.copyFileSync(path.join(__dirname, '../', 'barn', moo, `${moo}.new.${filetype}`), path.join(__dirname, '../', 'barn', moo, `${moo}.${filetype}`))
      if (filetype === 'db') return `${moo}.db`
    }

    if (fileExists && !newFileExists) {
      if (filetype === 'db') return `${moo}.db`
    }

    if (filetype === 'db') {
      throw this.server.notFoundError(moo, 'db')
    }
  }

  async findMooProcesses (format = 'array') {
    const processes = await findProcess('name', 'moo')
    if (format === 'array') {
      return processes
    } else if (format === 'pretty') {
      if (processes.length) {
        console.log(`\nFound moo-related process${processes.length > 1 ? 'es' : ''}:`)
        processes.forEach((proc, i) => {
          console.log(`  ${i + 1}. ${proc.name} [${proc.pid}] ${proc.cmd}`)
        })
        console.log()
      } else {
        console.log('\n No moo-related processes found\n')
      }
    }
  }

  prepareMooArgs (info) {
    if (info.mooArgs) {
      let emergencyMode = ''
      let startScript = ''
      let startLine = ''
      let logFile = ''
      let clearLastMove = ''
      let waifType = ''
      let outbound = ''
      let ipv4 = ''
      let ipv6 = ''
      let tlsCert = ''
      let tlsKey = ''
      let fileDir = ''
      let execDir = ''
      let ports = ''
      let tlsPorts = ''

      if (info.mooArgs.emergencyMode === true) {
        emergencyMode = '--emergency '
      }

      if (info.mooArgs.clearLastMove === true) {
        clearLastMove = '--clear-move '
      }

      if (info.mooArgs.outbound === true) {
        outbound = '--outbound '
      }

      if (info.mooArgs.outbound === false) {
        outbound = '--no-outbound '
      }

      if (info.mooArgs.tlsCert !== null) {
        tlsCert = `--tls-cert ${info.mooArgs.tlsCert} `
      }

      if (info.mooArgs.tlsKey !== null) {
        tlsKey = `--tls-key ${info.mooArgs.tlsKey} `
      }

      if (info.mooArgs.startScript) {
        startScript = `--start-script ${info.mooArgs.startScript} `
      }

      if (info.mooArgs.startLine) {
        startLine = `--start-line ${info.mooArgs.startLine} `
      }

      if (info.mooArgs.logFile) {
        logFile = `--log ${info.mooArgs.logFile} `
      }

      if (info.mooArgs.waifType) {
        waifType = `--waif-type ${info.mooArgs.waifType} `
      }

      if (info.mooArgs.ipv4) {
        ipv4 = `--ipv4 ${info.mooArgs.ipv4} `
      }

      if (info.mooArgs.ipv6) {
        ipv6 = `--ipv6 ${info.mooArgs.ipv6} `
      }

      if (info.mooArgs.fileDir) {
        fileDir = `--file-dir ${info.mooArgs.fileDir} `
      }

      if (info.mooArgs.execDir) {
        execDir = `--exec-dir ${info.mooArgs.execDir} `
      }

      if (info.mooArgs.ports) {
        ports = info.mooArgs.ports.map(port => {
          return `-p ${port} `
        }).join('')
      }

      if (info.mooArgs.tlsPorts) {
        tlsPorts = info.mooArgs.tlsPorts.map(port => {
          return `-t ${port} `
        }).join('')
      }

      const mooArgs = `${emergencyMode}${startScript}${startLine}${logFile}${clearLastMove}${waifType}${outbound}${ipv4}${ipv6}${tlsCert}${tlsKey}${fileDir}${execDir}`
      const portArgs = `${ports}${tlsPorts}`

      return [mooArgs, portArgs]
    } else {
      return ['', '']
    }
  }

  determineUptime (pidusageObj) {
    const formatUptime = (sec) => {
      const pad = (s) => {
        return (s < 10 ? '0' : '') + s
      }

      sec /= 1000
      const days = Math.floor(sec / (60 * 60 * 24))
      const hours = Math.floor(sec / (60 * 60))
      const minutes = Math.floor(sec % (60 * 60) / 60)
      const seconds = Math.floor(sec % 60)

      return `${days ? days + 'd' : ''}${hours ? pad(hours % ((days || 1) * 24)) + 'h' : ''}${minutes ? pad(minutes) + 'm' : ''}${pad(seconds)}s`
    }

    return formatUptime(pidusageObj.elapsed)
  }

  determineMemory (pidusageObj) {
    return `${(pidusageObj.memory / 1024 / 1024).toFixed(2)} MB`
  }

  determineProcessor (pidusageObj) {
    return pidusageObj.cpu.toFixed(2) + '%'
  }
}

// factory
module.exports = new ProcessController()
