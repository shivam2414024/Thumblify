import { useSearchParams } from 'react-router-dom'
import {yt_html} from '../assets/assets'

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
})[character]!)

const YtPreview = () => {

    const [searchParams] = useSearchParams()

    const thumbnail_url = escapeHtml(searchParams.get('thumbnail_url') ?? '')
    const title = escapeHtml(searchParams.get('title') ?? '')

    const new_html = yt_html.replace("%%THUMBNAIL_URL%%", thumbnail_url).replace("%%TITLE%%", title);

    return (
        <div className='fixed inset-0 z-100 bg-black'>
            <iframe srcDoc={new_html} width="100%" height="100%" allowFullScreen sandbox="allow-scripts"></iframe>
        </div>
    )
}

export default YtPreview