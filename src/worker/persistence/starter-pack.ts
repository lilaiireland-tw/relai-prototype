import type { PersistenceDatabase, PersistenceStatement } from './d1'
import type { EnglishLevel } from './types'

export const STARTER_BATCH_SIZE = 20
const SOURCE_DATASET = 'CEFR-J Vocabulary Profile'
const SOURCE_VERSION = '1.6'
export const ENGLISH_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const
export type { EnglishLevel } from './types'

type StarterResult =
  | { kind: 'created' | 'repeat'; english_level: EnglishLevel; starter_cards_created: number }
  | { kind: 'different_level'; english_level: EnglishLevel }
  | { kind: 'catalog_unavailable' }

interface SettingsLevel { english_level: EnglishLevel | null }
interface CatalogIdentity { id: string }
// Offline reviewed selection: relai-112-2026-11-12, frozen after quality screening.
export const STARTER_CATALOG_IDS: Record<EnglishLevel, readonly string[]> = {
  A1: [
    'cefr-j-3ee57dd1386a720a5dd7f7d6e2b594cf7af1d8177e33771ed8b75a0ed407ac59', // shoe (noun)
    'cefr-j-1161d9898cdc4a4a0ae7a538fb106012d774c115d2b7e440156de7fc6cf15f80', // already (adverb)
    'cefr-j-879a095244697a1e991cc59176072f77a69ff63aeed7dcc0cc4f832fe98d2f0c', // evening (noun)
    'cefr-j-e2db271fd2eed54fd4ebc785f6929d15365da1999c72813c2585cbbc19f4c055', // collect (verb)
    'cefr-j-90d2982fce2d8cc1544d3c08070936c7157576354b3b6738d0f026dd7995a941', // aunt (noun)
    'cefr-j-f1c248e45ee5bfa381bb91ea166d94363422f2337b9373e02f76589fe5dcb6f6', // please (adverb)
    'cefr-j-616057a0521553855a4e8fd769bd148a13ef06a8782c41e3486c531a777239a6', // wall (noun)
    'cefr-j-2a66b20a846acc0b9484fbe1821e95495ecc114e8e6d736bbfdbc1f70a456ecc', // church (noun)
    'cefr-j-45a827f9287f1f105d1a606f8c06a4dd1771d02f62a08b62d279bb14a3ac492d', // bright (adjective)
    'cefr-j-4fb0558f8ed269e3b13386b15913e7e9158b9a13b2b93350bdd9d606a2ffde8d', // tell (verb)
    'cefr-j-780d56543de7822624bd021f08ad479e6ebabf43ca0aa16d5473d91ba0ff7fc9', // uncle (noun)
    'cefr-j-f97893c8cd29cd2496ae9b531b745704a7f9c3f140ef3192020b75d52af21ced', // practice (noun)
    'cefr-j-146a8ce46bdab76d332ceeb51b0a63b9b9f36ff76a3fddad5f453149e49ac818', // zoo (noun)
    'cefr-j-609c9433cea50599941e360060acaaa391633965a21e41bac876b907258fdcfd', // gold (adjective)
    'cefr-j-59b46afdb7a8ef4205265135718a4ff1b84cd9047081b62c2f17736dbab493b9', // cute (adjective)
    'cefr-j-4bc0d8be485793e3b607adf85f8c44d213e2347c5d02bedcbd1493c80d5963e3', // show (verb)
    'cefr-j-368c069f28446d53a94d55bf6ceeaac2b8a696d1fc4bee0cccc8cf1f4e31a4a5', // dancing (noun)
    'cefr-j-ad8ab35897c2230ad06fa14ae4ece1b1090ffb2ff9f3aeb33bfb31b36c7b0d30', // outside (adverb)
    'cefr-j-d48ad175836bf27af940350c711a4dbdfdf8d93edac9829e0aaefa94251c4b55', // love (noun)
    'cefr-j-e6f206e668f922cc8666973c692f76d60f1363862ec77266984148f44985094c', // leaf (noun)
  ],
  A2: [
    'cefr-j-da4f42f1e41ddfdf682e5b96ced49208b70580130d7a886765a90037c41733a9', // diet (noun)
    'cefr-j-fac32f9f5f3bf90e7691a0166f2d6328917f87b964d8d354274efa40d74aa8a5', // adult (noun)
    'cefr-j-30b1b751a7ea0bdbbf0c43c850f85bbae818adf24ec60c6c38f3573dd27503ff', // wise (adjective)
    'cefr-j-8117f22bd2c7b0b74e8d54f46f322fa0a1ef9c0abce6fb0ed7bfdfcfe274aa42', // somewhere (adverb)
    'cefr-j-1e353927ddd5faffdb1ff1721f3816c7bf5b5790bfd6f1747c106746f0692979', // choice (noun)
    'cefr-j-8df20fefb0ac784f72ab8dd5dd4b114dffdab6ffb7f43f4be7a2a4a263992f10', // pronunciation (noun)
    'cefr-j-a69142609915a1b90ffcfaa56515518a1219f732d7ec6e1b0f721449d3e44743', // romantic (adjective)
    'cefr-j-3efa7602c1dc8d312448fe49e2290eee307d3f96cc7c01029d2f136f245e70cf', // daily (adjective)
    'cefr-j-68a9e1142793210bb661ebc509341dd66520c74044a770f78a0986018e56eaf9', // perhaps (adverb)
    'cefr-j-18cd346f6b9c4df834ef20f2848c77145a6979e18b02d86de18bca3ed6eaa99b', // bug (noun)
    'cefr-j-840bd54505a01a8113bfe6afcddb067873c80c5dce67220f094b782710074bc8', // jelly (noun)
    'cefr-j-e3ef2c107b34c8a62b96122291a5b9f2464e3f0ea706a50d6e1bdb48e4547110', // rather (adverb)
    'cefr-j-9ba6b07404a8ab23338dfaaabec0c3860e7bf68e88369106d35b202e2ca53416', // offer (noun)
    'cefr-j-585fba065cc3737f7f992222ee384b32212f666bb67e0b3e7add3e76c29729be', // leather (noun)
    'cefr-j-9e287a4fe61f35ac805db94645c550d76136292d144de65f78cb7c0e940c029c', // diary (noun)
    'cefr-j-3f99af71f1f34b52237a7f5c3358009d3e0343d5c08b0c1b8c7cac1c0820dfea', // negative (adjective)
    'cefr-j-160e318271184fad80c7e57283e0b01f72baca28cad9e38e1163cc5767cf6389', // guard (noun)
    'cefr-j-e40c780c533de102bd92f735732cc3b60fa566d837521e70635f24dd8f9748a5', // unfair (adjective)
    'cefr-j-611d6f569ed1486001641b2cbfd5870a76ac9635a012e971fbb1a63dbfa0aa83', // complete (adjective)
    'cefr-j-91804679753a250c3192b88068c23c7b556e5f1de8c2fcff9692ca9c7fd196b4', // dislike (noun)
  ],
  B1: [
    'cefr-j-dfceb22e8e1fda62376a88fee1dfd8b2604b69a84b30ef2d8764f1170f73a730', // academy (noun)
    'cefr-j-d42b2476a858afd54cdc5ad22918c1ab6c06ac477235767e42dbd833d15b06e3', // absorb (verb)
    'cefr-j-2b457df7c93e8c57b865bfb37c0b6034abfe1177870dc1cca633842463824797', // abandon (verb)
    'cefr-j-c31796bc6e5ae3cbf6c51f81396f96c85ed67bfc3c576c6f58e617e4e8691c20', // absent (adjective)
    'cefr-j-395c607cac2cdd824f5c3bd686fcf574b9a4405c4bee33c7583232b11b9b2221', // aboard (adverb)
    'cefr-j-4b130ae7c604c80184634dee4c3ea3808d58042a548c7ace6247f39540862e64', // abstract (adjective)
    'cefr-j-1f6c73ab80d7891882ecfa8838127b0ecdc95d8b13b5386c3bd6977b5b0c3e9a', // access (noun)
    'cefr-j-3b2aeb6ae24efc8b8b7970e2035335513f89cea647b0d749b985cf9ccebc19bd', // acceptance (noun)
    'cefr-j-948ed8080a9c641090c2f17da73cb9040b5bad5e9f60e1b7262e0120bf7dd01a', // abundant (adjective)
    'cefr-j-a5b404b067ef90abdb371db11536aa98c8f6dfb3cf3c1da86ad4cc3104c5f498', // accent (noun)
    'cefr-j-7bad62bf11e05fa1ae94fe576ff40ef7d0f24a917f96b6bb1d1875641d694238', // aborigine (noun)
    'cefr-j-517570934d8d57e89f8bc6c79c6029f177b429bba75fc9c0b3420926c473d098', // abnormal (adjective)
    'cefr-j-1c3bf39bb9f3c5819ca0b325ceed42b49c8d36dbd23d91c64d28e5a314d6b5de', // accessible (adjective)
    'cefr-j-1824acccfa941b57d28c507a27babad4290e79de8bc7dfb44bd7c6c875c0357e', // abundance (noun)
    'cefr-j-9858b1bfa52455b86b0a3c6b1ae05a8cb4677f1594ec1191734985034ada6bcd', // able (adjective)
    'cefr-j-be25ead38520cb4d2e3ecdc6610636bc11ec8e9c6e90198d0dd2bb69eec206d5', // absolutely (adverb)
    'cefr-j-8c7983d2d5354901e0a9bc8eb6f887bd838d212d4102afc37e4e590b92a9eedc', // absolute (adjective)
    'cefr-j-afc7a18efcc7a64e79fcbf689323023ff5ff5816f4702daf7db12ff6a7c6c581', // above (adjective)
    'cefr-j-6c7117313075189b9a9a84840efeb2482ce3a1fcb28c0ff45d898b882b7578c6', // absence (noun)
    'cefr-j-ec68181e00cce3b0efca69e22c32ae94d75f5f357c1127a13b49afddfa3ed605', // academic (adjective)
  ],
  B2: [
    'cefr-j-a2c2db3184db402153363d0d145d6e12f95b174f627769f207d464e5bc417593', // misunderstand (verb)
    'cefr-j-ceadc3854f59b16c405c26ee8d9191197ef2a8a1899ccd35531f9bfe11e70b13', // mathematical (adjective)
    'cefr-j-aedf08016c8f2ea7fe6eee9572d356bd72f6a294f4101cad4c064815514f9a79', // exhaust (noun)
    'cefr-j-c86ebacca04fdb3f4caea05983f4c6346215f92a8d16f1446689427333e3256b', // untreated (adjective)
    'cefr-j-45b447d6cd39543917664f422f768d5c72727736e354a8bbd8c1838e225199d8', // stepfather (noun)
    'cefr-j-d4d90c767d6e1115aed29f1d0740b3eb669c2192c6dbfeb8c43edd5bc77fed38', // debit (noun)
    'cefr-j-49a37a150aa39c52098f8de1dbe3fe50df44e645c2598837058273407b8db421', // unwilling (adjective)
    'cefr-j-729413413172d0cd48cf35a97465f616327eb47dcf7a89bddf0add7f687d18fa', // circuit (noun)
    'cefr-j-3c937a7a752d6d38848ced1d25b96e2e70344e322aa1dde072468c6ef22ffd23', // compulsory (adjective)
    'cefr-j-d2ed1789075eba6ef83f6cbe2d3977dd45d2a1bed7f65b2614ba2888ab43503e', // inherit (verb)
    'cefr-j-67a7b54951623ea2feb5555e2262b878f68330ad9ccdffd1d6c228a9f4b8757d', // reprint (noun)
    'cefr-j-8f5a3a936ffaea7ef9ced0009eaece48ae5780fe435466f705af1d80d095706e', // diplomat (noun)
    'cefr-j-32e052a02881c7054d9c4c926f3a35c5d96527373eb2a9c3941ca6f714480cd2', // influenza (noun)
    'cefr-j-dca6e9e94d25d4ee207f774361c6e71de9438f24769e7ce42f060690765fc827', // coaching (noun)
    'cefr-j-9df110911654add47ef416783725a03bfbe9c072e2b18b76e15fcccb967ca00c', // temporarily (adverb)
    'cefr-j-17f535e6ed8c0f067774da90a0438d66595bfbe163c033022721a11632562650', // privilege (noun)
    'cefr-j-ed9b0cc578edda4126eca0711da2095e0826529714f6ac03509dead56f154f1e', // flexibility (noun)
    'cefr-j-eb2474bc640f542efc1942051c079b63481d70113ad8bb7038810bdc7f5c2c20', // ballot (noun)
    'cefr-j-ea9ef414813253e822b9174183cad859c31d35102f2762328045f83e3457114c', // nourish (verb)
    'cefr-j-2816953a153b16f63dc14c515294938d4a915647f3cef7cf4fd5413ee9603da2', // scooter (noun)
  ],
}

const validCatalog = `source_dataset = ? AND source_version = ? AND cefr_level = ?
  AND publication_status = 'published' AND owner_user_id IS NULL
  AND NULLIF(TRIM(headword), '') IS NOT NULL
  AND NULLIF(TRIM(part_of_speech), '') IS NOT NULL
  AND NULLIF(TRIM(sense_key), '') IS NOT NULL
  AND NULLIF(TRIM(zh_tw_definition), '') IS NOT NULL
  AND NULLIF(TRIM(english_example), '') IS NOT NULL
  AND NULLIF(TRIM(zh_tw_example_translation), '') IS NOT NULL`

/** Initial level selection only. The claim and materialization are one D1 transaction. */
export async function bootstrapStarterPack(
  db: PersistenceDatabase, userId: string, level: EnglishLevel, at: string,
): Promise<StarterResult> {
  if (!db.batch) throw new Error('D1 batch is required for starter bootstrap.')

  const current = await db.prepare('SELECT english_level FROM user_settings WHERE user_id = ?')
    .bind(userId).first<SettingsLevel>()
  if (current?.english_level) {
    return current.english_level === level
      ? { kind: 'repeat', english_level: level, starter_cards_created: 0 }
      : { kind: 'different_level', english_level: current.english_level }
  }

  const approved = STARTER_CATALOG_IDS[level]
  const placeholders = approved.map(() => '?').join(', ')
  const catalogQuery = `SELECT id FROM vocabulary_catalog WHERE id IN (${placeholders}) AND ${validCatalog}`
  const catalogBindings = [...approved, SOURCE_DATASET, SOURCE_VERSION, level]
  const candidates = await db.prepare(catalogQuery).bind(...catalogBindings).all<CatalogIdentity>()
  if (!candidates.success) throw new Error('Could not select CEFR-J starter entries.')
  if (candidates.results.length !== STARTER_BATCH_SIZE) return { kind: 'catalog_unavailable' }

  const ids = approved.map(id => [id, crypto.randomUUID()] as const)
  const values = ids.map(() => '(?, ?)').join(', ')
  const statements: PersistenceStatement[] = [
    // Revalidate inside the transaction: drift must abort before cards or level are written.
    db.prepare(`SELECT CASE WHEN COUNT(*) = ${STARTER_BATCH_SIZE} THEN 1
      ELSE json('starter_catalog_unavailable') END FROM (${catalogQuery})`)
      .bind(...catalogBindings),
    db.prepare(`WITH chosen(catalog_id, card_id) AS (VALUES ${values})
      INSERT INTO flashcards (id, user_id, card_type, vocabulary_catalog_id, created_at, updated_at)
      SELECT chosen.card_id, ?, 'vocabulary', catalog.id, ?, ?
      FROM chosen JOIN vocabulary_catalog AS catalog ON catalog.id = chosen.catalog_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_settings WHERE user_id = ? AND english_level IS NOT NULL
      ) AND NOT EXISTS (
        SELECT 1 FROM flashcards AS owned WHERE owned.user_id = ?
          AND owned.card_type = 'vocabulary' AND owned.vocabulary_catalog_id = catalog.id
      ) ON CONFLICT DO NOTHING`)
      .bind(...ids.flat(), userId, at, at, userId, userId),
    db.prepare(`INSERT INTO user_stats (user_id, total_cards_created, updated_at)
      SELECT ?, changes(), ? WHERE changes() > 0
      ON CONFLICT(user_id) DO UPDATE SET
        total_cards_created = user_stats.total_cards_created + excluded.total_cards_created,
        updated_at = excluded.updated_at`).bind(userId, at),
    db.prepare(`INSERT INTO user_settings (user_id, timezone, english_level, created_at, updated_at)
    VALUES (?, 'UTC', ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET english_level = excluded.english_level,
      updated_at = excluded.updated_at WHERE user_settings.english_level IS NULL`)
      .bind(userId, level, at, at),
  ]
  const results = await db.batch(statements)
  if (results.length !== statements.length || results.some(result => !result.success)) {
    throw new Error('Starter bootstrap batch failed.')
  }
  const chosenLevel = await db.prepare('SELECT english_level FROM user_settings WHERE user_id = ?')
    .bind(userId).first<SettingsLevel>()
  if (!chosenLevel?.english_level) throw new Error('Starter level was not persisted.')
  if (chosenLevel.english_level !== level) {
    return { kind: 'different_level', english_level: chosenLevel.english_level }
  }
  return results[3].meta.changes === 1
    ? { kind: 'created', english_level: level,
      starter_cards_created: results[1].meta.changes }
    : { kind: 'repeat', english_level: level, starter_cards_created: 0 }
}
