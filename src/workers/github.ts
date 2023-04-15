
import type { Repository, User } from '../types/github'
import type { Author, DBCollections, Keyword, Publication, Stage } from '../types'
import request from 'request-promise'

const
BREAK_DELAY = 3,
MAX_KEYWORDS_BY_QUEUE = 10,
INITIAL_KEYWORD = 'role',
GITHUB_BASE_URL = 'https://api.github.com'

async function searchRepositories( keyword: string ): Promise<Repository[]> {
  try {
    const
    options = {
      url: `${GITHUB_BASE_URL}/search/repositories?q=${keyword}`,
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
        'User-Agent': 'PostmanRuntime/7.31.3'
      },
      json: true
    },
    { error, message, items } = await request( options )
    if( error ) throw new Error( message )

    return items
  }
  catch( error ){ 
    console.log(`Failed search for <${keyword}>: `, error )
    return []
  }
}

async function getUser( username: string ): Promise<User | null> {
  try {
    const
    options = {
      url: `${GITHUB_BASE_URL}/users/${username}`,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.GITHUB_ACCESS_TOKEN}`,
        'User-Agent': 'PostmanRuntime/7.31.3'
      },
      json: true
    }

    return await request( options )
  }
  catch( error ){ 
    console.log(`Failed getting user <${username}>: `, error )
    return null
  }
}

export default async ( dbc: DBCollections ) => {

  async function saveAuthor( repo: Repository, author: Author ){
    
    const publication: Publication = {
      name: repo.full_name,
      source: 'github'
    }
  
    // Author email strictly required
    if( !author.email ) return
    console.log(`\t\t----- Saving author <${author.email}>`)

    // Check existing author
    const
    condition = { email: author.email },
    exists = await dbc.Authors.findOne( condition ) as unknown as Author
    if( exists ){
      console.log(`\t\t----- Author Exists <Update>`)

      // This publication is already recorded
      if( exists.publications?.filter( each => { return each.name == repo.full_name } ).length )
        return

      // Record new publication of this author
      await dbc.Authors.updateOne( condition, { $push: { publications: publication } } )
      return
    }

    // New author entry
    author.publications = [ publication ]
    await dbc.Authors.insertOne( author )
  }

  async function storeKeywords( keywords: string[] ){
    await Promise.all( keywords.map( async value => {
      console.log(`\t\t----- Saving keywords <${value}>`)

      if( await dbc.Keywords.findOne({ value }) ) return
      await dbc.Keywords.insertOne({ value, timestamp: Date.now() } as Keyword )
    } ) )
  }

  async function worker( keywords: Keyword[] ){
    console.log(`-- GITHUB: NEW JOB [${keywords.length}] keywords --`)

    // Fetch repo by keywords
    await Promise.all( keywords.map( async keyword => {
      // Search repos by keyword
      console.log(`\t\tSearching <${keyword.value}> ...`)
      const repos = await searchRepositories( keyword.value )

      console.log(`\t\tRepositories [${repos.length}]`)
      if( !repos.length ) return

      // Set on stage keywork
      await dbc.Stages.updateOne({ worker: 'github' }, { $set: { lastKeyword: keyword } }, { upsert: true })

      await Promise.all( repos.map( async each => {
        // Get user information
        const user = await getUser( each.owner.login )
        if( !user ) return
        
        const author: Author = {
          name: user.name,
          username: user.login,
          email: user.email,
          blog: user.blog,
          location: user.location
        }

        // Save author details
        await saveAuthor( each, author )
        // Store keywords for next search
        each.topics
        && await storeKeywords( each.topics )
      } ) )
    } ) )

    console.log('-- GITHUB: GOING NEXT ... --')

    // Relaunch the worker with next list of keywords
    setTimeout( async () => {
      // Record timestamp where to query the next list of keywords from
      const
      lastTimestamp = keywords.slice(-1)[0].timestamp,
      results = await dbc.Keywords.find({ timestamp: { $gte: lastTimestamp } })
                                  .limit( MAX_KEYWORDS_BY_QUEUE )
                                  .toArray() as unknown as Keyword[]
      if( !results.length ){
        console.log('-- GITHUB: JOB COMPLETED --')
        return
      }
      
      // Start a job queue
      worker( results )
    }, BREAK_DELAY * 1000 )
  }

  // Initial keywords
  let keywords = [{ value: INITIAL_KEYWORD, timestamp: 0 }]

  // Use previous job's stage keyword
  const stage = await dbc.Stages.findOne({ worker: 'github' }) as unknown as Stage
  if( stage ) keywords = [ stage.lastKeyword ]

  // Launch worker
  worker( keywords )
}
