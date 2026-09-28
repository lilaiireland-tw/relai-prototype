// Static assets serve the client; application API routing belongs to Issue #11.
export default {
  fetch(): Response {
    return new Response(null, { status: 404 })
  },
}
