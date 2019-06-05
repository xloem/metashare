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
    for (var a = 0; a < ret.length; ++a) { ret[a] = (ret[a] % 0x5e) + 0x20 } // human-readable
  }
  if (choice < 1) { return ret.toString('utf8') }
  if (choice < 2) { return ret.toString() }
  if (choice < 3) { return ret }
}

function randObj () {
  const ret = {}
  const count = randInt(10)
  for (let i = 0; i < count; ++i) { ret[randData().toString()] = randData() }
  return ret
}

const TEST_DBFILE = 'db/test.sqlite'
const TEST_DBCONFIG = { client: 'sqlite3', connection: { filename: TEST_DBFILE }, debug: DEBUG, asyncStackTraces: DEBUG }

async function setup () {
  try { fs.unlinkSync(TEST_DBFILE) } catch (e) {}
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
              putobj[col.name] = randObj()
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
          putobj.origid = putobj.id
          putobj.orignetid = objs.net[0].id
        }
      }
    })
    describe('compare puts with gets', () => {
      for (let type in schemas) {
        it('get ' + type + 's in 3 ways and compare all with puts', async () => {
          for (let obj1 of objs[type]) {
            const obj2 = await metashareTest.get(type, objs.net[0].dbid, { 'dbid': obj1.dbid })
            assert.deepStrictEqual([obj1], obj2)
          }
          for (let obj1 of objs[type]) {
            const obj2 = await metashareTest.get(type, objs.net[0].dbid, { 'id': obj1.id })
            assert.deepStrictEqual([obj1], obj2)
          }
          assert.deepStrictEqual(objs[type], await metashareTest.get(type, objs.net[0].dbid))
        })
      }
    })
    describe('mirroring into a second net', () => {
      const objs2 = {}
      const id0to1 = {}
      it('mirror items into a new net', async () => {
        const putobj = {
          id: randData(),
          time: randTime()
        }
        await metashareTest.put('net', null, putobj)
        objs.net.push(putobj)
        objs2.net = [putobj]

        // enumerate all items?
        //    -> this would be nice as a stream.  can do everything at once for now.
        const imports = []
        for (let type in schemas) {
          objs2[type] = []
          const set = await metashareTest.get(type, objs.net[0].dbid)
          for (let item of set) { item.type = type }
          imports.push(...set)
        }
        imports.sort((a, b) => a.dbid - b.dbid)
        for (let item of imports) {
          const obj = {
            id: randData()
          }
          id0to1[item.id] = obj.id
          if (randChoice()) { obj.cust = randObj() }
          objs2[item.type].push(obj)
          await metashareTest.mirror(item.type, objs.net[1].dbid, item.dbid, obj)
          assert.strictEqual(obj.dbid, item.dbid)
        }
      })
      for (let type in schemas) {
        if (type === 'net') continue
        it('get mirrored ' + type + 's back and compare', async () => {
          assert.strictEqual(objs2[type].length, objs[type].length)
          for (let i = 0; i < objs2[type].length; ++i) {
            const obj2 = objs2[type][i]
            const obj1 = Object.assign(Object.assign({}, objs[type][i]), obj2)
            const obj3 = await metashareTest.get(type, objs.net[1].dbid, { 'dbid': obj1.dbid })
            if ('priv' in obj1) delete obj1.priv
            if ('cust' in obj2) { obj1.cust = obj2.cust } else { delete obj1.cust }
            for (let col of Object.values(schemas[type].refs)) {
              if (col.name in obj1) { obj1[col.name] = id0to1[obj1[col.name]] }
            }
            assert.deepStrictEqual([obj1], obj3)
          }
        })
      }
    })
    describe('teardown test db', () => {
      it('destroy & delete', async () => {
        await metashareTest.destroy()
        fs.unlinkSync(TEST_DBFILE)
      })
    })
    describe('default database', () => {
      it('constructs without error', async () => {
        metashareReal = await Metashare()
      })
      it('destroys without error', async () => {
        await metashareReal.destroy()
      })
    })
  })

  run()
}

setup()
