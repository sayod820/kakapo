import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{minHeight:'100vh',background:'#030B05',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',fontFamily:'Nunito,sans-serif',color:'#EBF5ED'}}>
      <div style={{fontSize:64,marginBottom:16}}>🦜</div>
      <div style={{fontFamily:'Unbounded,sans-serif',fontSize:24,fontWeight:900,marginBottom:8}}>404</div>
      <div style={{color:'#8FB897',marginBottom:24}}>Страница не найдена</div>
      <Link href="/" style={{padding:'12px 24px',borderRadius:12,background:'linear-gradient(135deg,#17B34E,#1FD760)',color:'#030B05',fontWeight:800,textDecoration:'none'}}>На главную</Link>
    </div>
  )
}
