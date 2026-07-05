import type { GetServerSideProps } from 'next'

/**
 * The templates index is retired — everything is scoped to GAMES now (templates became a reusable
 * resource reached only inside a game). Anyone hitting /personal-projects/game-engine lands on the
 * games gallery. Server-side redirect = no flash of an old page.
 */
export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: { destination: '/personal-projects/game-engine/games', permanent: false },
})

export default function GameEngineIndexRedirect() {
  return null
}
