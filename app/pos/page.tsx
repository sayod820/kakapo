import { redirect } from 'next/navigation'

/** Старый маршрут /pos → новое приложение «Торговля» */
export default function PosRedirectPage() {
  redirect('/trade')
}
