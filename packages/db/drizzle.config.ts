import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

// Parse MySQL URL: mysql://user:password@host:port/database
function parseMysqlUrl(url: string) {
  const regex = /mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/
  const match = url.match(regex)
  if (!match) throw new Error('Invalid MySQL URL format')
  return {
    user: match[1],
    password: match[2],
    host: match[3],
    port: parseInt(match[4]),
    database: match[5],
  }
}

const dbUrl = process.env.DATABASE_URL || ''
const credentials = dbUrl ? parseMysqlUrl(dbUrl) : { host: '', database: '', user: '', password: '', port: 3306 }

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'mysql',
  dbCredentials: {
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
  },
  verbose: true,
  strict: true,
})
