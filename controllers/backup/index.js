const fs = require('fs')
const path = require('path')
const child_process = require('child_process')

class BackupController {
  async init ({
    server,
    defaultBackupFinalScript,
    defaultBackupIntervalHours
  }) {
    this.server = server
    this.defaultBackupFinalScript = defaultBackupFinalScript
    this.defaultBackupIntervalHours = defaultBackupIntervalHours
  }

  async start () {
    if (this.server.FLAG === 'verbose') console.log('[#] Starting backup controller...')
    this.loadState()
  }

  stop () {
    if (this.server.FLAG === 'verbose') console.log('[#] Stopping backup controller...')
  }

  loop () {
    const state = this.loadState()

    state.globalInterval++

    this.server.barn.forEach((value, key) => {
      if (!state.mooIntervals[key]) {
        state.mooIntervals[key] = 0
      }
    })

    for (const prop in state.mooIntervals) {
      const moo = this.server.barn.get(prop)
      if (moo) {
        if (!moo.disabled && moo.backup.intervalHours !== 0 && moo.backup.intervalHours !== null) {
          state.mooIntervals[prop]++
        }
      } else {
        delete state.mooIntervals[prop]
      }
    }

    if (state.globalInterval >= this.defaultBackupIntervalHours) {
      this.backupAll(true)
      state.globalInterval = 0
    }

    for (const prop in state.mooIntervals) {
      const info = this.server.barn.get(prop)
      if (info && info.backup.intervalHours) {
        if (state.mooIntervals[prop] >= info.backup.intervalHours) {
          this.backupMoo(prop)
          state.mooIntervals[prop] = 0
        }
      }
    }

    this.setState(state)
  }

  backupMoo (moo) {
    const info = this.server.barn.get(moo)
    let result
    if (info && !info.disabled) {
      this.prepareBackupFolder(moo)

      const dateObj = new Date()
      const [date, time] = dateObj.toISOString().split('T')
      const [year, month, day] = date.split('-')
      const [hour, minute] = time.split(':')

      try {
        fs.copyFileSync(path.join(__dirname, '../../', 'barn', moo, `${moo}.new.db`), path.join(__dirname, '../..', 'barn', moo, 'backup', `${year}_${month}_${day}_${hour}_${minute}_${moo}.db`))

        const backup = info.backup
        backup.last = dateObj.getTime()

        this.server.setMooInfo(moo, { backup })

        result = `[>] Successfully backed up ${moo} moo at ${dateObj}...`
        console.log(result)
      } catch {
        result = this.server.backupFailedError(moo)
        console.log(result)
      }
      if (info.backup.finalScript) {
        child_process.spawn(`sh ${info.backup.finalScript}`, [], { shell: true, detached: false, stdio: 'inherit' })
      }
      return result
    } else if (!info) {
      result = this.server.notFoundError(moo, 'moo')
      console.log(result)
      return result
    } else {
      result = this.server.mooDisabledError(moo)
      console.log(result)
      return result
    }
  }

  backupAll (customIntervals = false) {
    const result = '[%] Backing up moos...'
    console.log(result)
    this.server.barn.forEach((value, key) => {
      if (!customIntervals) {
        if (value && !value.disabled && value.backup.intervalHours === null) {
          this.backupMoo(key)
        }
      } else {
        if (value && !value.disabled) {
          this.backupMoo(key)
        }
      }
    })
    return result
  }

  prepareBackupFolder (moo) {
    if (!fs.existsSync(path.join(__dirname, '../../', 'barn', moo, 'backup'))) {
      fs.mkdirSync(path.join(__dirname, '../../', 'barn', moo, 'backup'), { recursive: true }, (e) => {
        throw e
      })
    }
  }

  loadState () {
    try {
      return require('./state.json')
    } catch {
      console.log(this.server.notFoundForError('state.json', 'backup controller'))
      return this.setState()
    }
  }

  setState (info, replace = false) {
    if (!info) {
      const mooIntervals = Object.fromEntries(this.server.barn)
      for (const moo in mooIntervals) {
        mooIntervals[moo] = 0
      }

      const initInfo = {
        globalInterval: 0,
        mooIntervals
      }

      return fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify(initInfo, null, '\t'), e => {
        throw e
      })
    }

    let data

    if (replace) {
      data = info
    } else {
      data = this.loadState()
    }

    fs.writeFileSync(path.join(__dirname, 'state.json'), JSON.stringify({ ...data, ...info }, null, '\t'), e => {
      throw e
    })
  }
}

// factory
module.exports = new BackupController()
