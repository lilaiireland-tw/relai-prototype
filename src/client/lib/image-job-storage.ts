const keyStorage = 'relai.image-job.key'
const idStorage = 'relai.image-job.id'

export function readImageJobReference() {
 return { key: window.localStorage.getItem(keyStorage), id: window.localStorage.getItem(idStorage) }
}

export function imageJobIdempotencyKey() {
 const key = window.localStorage.getItem(keyStorage) ?? crypto.randomUUID()
 window.localStorage.setItem(keyStorage, key)
 return key
}

export function saveImageJobId(id: string) {
 window.localStorage.setItem(idStorage, id)
}

export function clearImageJobReference() {
 window.localStorage.removeItem(keyStorage)
 window.localStorage.removeItem(idStorage)
}
