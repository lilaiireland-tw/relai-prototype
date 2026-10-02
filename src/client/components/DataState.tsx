export default function DataState({ loading, error, retry }: { loading: boolean; error: string; retry: () => void }) {
 return <>
  {loading && <p role="status" className="py-4 text-sm text-text-secondary">正在讀取資料…</p>}
  {error && <div className="my-4 rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">
   <p role="alert">{error}</p><button type="button" onClick={retry} className="mt-2 underline">重試</button>
  </div>}
 </>
}
