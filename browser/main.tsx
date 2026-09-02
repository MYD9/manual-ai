import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import ManualApp from '../components/manual-app';
import '../app/globals.css';
import './pages.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() {
    return this.state.error ? <main className="pages-error"><h1>暂时无法打开资料库</h1><p>请刷新重试。你的浏览器资料不会被自动清除。</p><button onClick={() => location.reload()}>重新加载</button></main> : this.props.children;
  }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><div className="pages-banner" role="note"><strong>浏览器体验版</strong><span>空白起步 · 数据仅存此浏览器 · AI / PDF 等功能需本地完整版</span><a href="https://github.com/MYD9/manual-ai" target="_blank" rel="noreferrer">获取完整源码 ↗</a></div><ManualApp /></ErrorBoundary>);
