'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from '@/components/ui/drawer';
import { X } from 'lucide-react';
export function WorkspaceNavigation({
  children,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = matchMedia('(max-width:760px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  if (!compact)
    return (
      <aside id="workspace-navigation" className="sidebar">
        {children}
      </aside>
    );
  return (
    <Drawer open={open} onOpenChange={onOpenChange} swipeDirection="left">
      <DrawerContent className="mobile-navigation" id="workspace-navigation">
        <DrawerTitle className="sr-only">知识库导航</DrawerTitle>
        <DrawerDescription className="sr-only">
          选择资料库、分类或设置
        </DrawerDescription>
        <div className="sidebar navigation-content">
          <DrawerClose
            className="icon-btn mobile-nav-close"
            aria-label="关闭导航"
          >
            <X size={18} />
          </DrawerClose>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
