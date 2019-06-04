const Metashare = require('../metashare/metashare')

const assert = require('assert')

const fs = require('fs')
const crypto = require('crypto')

const DEBUG = false

function randInt (max) {
  max = Math.floor(max)
  const bcount = Math.ceil(Math.log2(max) / 8)
  assert(bcount < 7)
  const cap = 256 ** bcount
  var num
  do {
    const bytes = crypto.randomBytes(bcount)
    num = 0
    for (let b of bytes) { num = (num * 256) + b }
  } while (num > cap - (cap % max))
  return num % max
}

function randFloat () {
  return crypto.randomBytes(8).readDoubleLE(0)
}

var FAKETIME = randInt(Date.now() * 2)
function randTime () {
  FAKETIME += randInt(Date.now() / 16777216)
  return FAKETIME - randInt(Date.now() / 4294967296) // near-monotonic
}

function randChoice () {
  return randInt(2) === 1
}

function randData (choice = randInt(2)) {
  var ret = crypto.randomBytes(randInt(DEBUG ? 32 : 1024) + 1)
  if (DEBUG) {
    for (var a = 0; a < ret.length; ++a) { ret[a] = (ret[a] % 0x5e) + 0x20 }
  } // human-readable
  if (choice < 1) { return ret.toString('utf8') }
  if (choice < 2) { return ret.toString() }
  if (choice < 3) { return ret }
}

const TEST_DBFILE = 'db/test.sqlite'
const TEST_DBCONFIG = { client: 'sqlite3', connection: { filename: TEST_DBFILE }, debug: DEBUG, asyncStackTraces: DEBUG }

async function setup () {
  try { fs.unlink(TEST_DBFILE) } catch (e) {}
  var metashareReal
  var metashareTest = await Metashare(TEST_DBCONFIG)
  const schemas = {}
  for (let type of metashareTest.types()) {
    schemas[type] = metashareTest.schema(type)
  }

  describe('metashare db', () => {
    const objs = {}
    var netct = 0
    it('put 10x each type for one net', async () => {
      for (let i = 0; i < 10; ++i) {
        for (let type in schemas) {
          if (type === 'net') {
            if (netct > 0) continue
            ++netct
          }
          const schema = schemas[type]
          const putobj = {}
          putobj.id = randData()
          const vals = Object.values(schema.vals)
          vals.push({ optional: true, type: 'json', name: 'cust' })
          if (type === 'user') { vals.push({ optional: true, type: 'json', name: 'priv' }) }
          for (let col of vals) {
            if (col.optional && randChoice()) continue
            if (col.type === 'enum') {
              putobj[col.name] = col.enums[randInt(col.enums.length)]
            } else if (col.type === 'datetime') {
              putobj[col.name] = randTime()
            } else if (col.type === 'varchar') {
              putobj[col.name] = randData()
            } else if (col.type === 'float') {
              putobj[col.name] = randFloat()
            } else if (col.type === 'json') {
              const obj2 = {}; const count = randInt(10)
              for (let i = 0; i < count; ++i) { obj2[randData().toString()] = randData() }
              putobj[col.name] = obj2
            } else {
              assert.fail('Unrecognised field type "' + col.type + '"')
            }
          }
          for (let col of Object.values(schema.refs)) {
            if (col.optional && randChoice()) continue
            var coltype = col.type
            if (coltype === 'item') {
              let types = Object.keys(objs)
              coltype = types[randInt(types.length)]
            }
            if (!(coltype in objs)) continue
            putobj[col.name] = objs[coltype][randInt(objs[coltype].length)].id
          }
          const netdbid = 'net' in objs && '0' in objs.net ? objs.net[0].dbid : null
          assert(netdbid !== null || type === 'net')
          await metashareTest.put(type, netdbid, putobj)
          if (!(type in objs)) objs[type] = []
          objs[type].push(putobj)
        }
      }
    })
    describe('compare puts with gets', () => {
      for (let type in schemas) {
        it('get ' + type + 's by orig dbid', async () => {
          for (let obj1 of objs[type]) {
            const obj2 = await metashareTest.get(type, objs.net[0].dbid, { 'origdbid': obj1.dbid })
            assert.deepStrictEqual([obj1], obj2)
          }
        })
        it('get ' + type + 's by net id', async () => {
          for (let obj1 of objs[type]) {
            const obj2 = await metashareTest.get(type, objs.net[0].dbid, { 'id': obj1.id })
            assert.deepStrictEqual([obj1], obj2)
          }
        })
        it('get all net ' + type + 's', async () => {
          assert.deepStrictEqual(objs[type], await metashareTest.get(type, objs.net[0].dbid))
        })
      }
      after(async () => {
        await metashareTest.destroy()
        fs.unlinkSync(TEST_DBFILE)
      })
    })
    describe('default database', () => {
      it('constructs without error', async () => {
        metashareReal = await Metashare()
      })
      it('destroys without error', async () => {
        metashareReal.destroy()
      })
    })
  })

  run()
}

setup()
