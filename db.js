// db.js — lowdb 초기화
import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { existsSync, writeFileSync } from 'fs'

const defaultData = { users: [], reviews: [], comments: [] }

if (!existsSync('db.json')) {
  writeFileSync('db.json', JSON.stringify(defaultData, null, 2), 'utf-8')
}

const adapter = new JSONFile('db.json')
const db = new Low(adapter, defaultData)

export async function initDb() {
  await db.read()
  if (!db.data || !db.data.users) {
    db.data = defaultData
    await db.write()
  }
}

export default db