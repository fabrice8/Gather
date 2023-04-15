
type Maintainer = {
  username: string
  email: string
}

export type Package = {
  package: {
    name: string
    scope: string
    version: string
    description: string
    keywords?: string[],
    date: string
    links: { [index: string]: string }
    author?: {
      name: string
      email: string
      url: string
      username: string
    }
    publisher: Maintainer
    maintainers: Maintainer[]
  }
  score: {
    final: number
    detail: {
      quality: number
      popularity: number
      maintenance: number
    }
  }
  searchScore: number
}