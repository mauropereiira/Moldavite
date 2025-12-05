import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from '../sidebar/Sidebar';
import { Editor } from '../editor/Editor';
import { RightPanel } from './RightPanel';
import { useSettingsStore } from '@/stores';

// Sidebar constraints
const LEFT_SIDEBAR_MIN = 200;
const LEFT_SIDEBAR_MAX = 400;
const RIGHT_PANEL_MIN = 250;
const RIGHT_PANEL_MAX = 500;

type ResizeTarget = 'left' | 'right' | null;

export function Layout() {
  const {
    sidebarWidth,
    rightPanelWidth,
    setSidebarWidth,
    setRightPanelWidth
  } = useSettingsStore();

  const [isResizing, setIsResizing] = useState<ResizeTarget>(null);
  const [isHovering, setIsHovering] = useState<ResizeTarget>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback((target: ResizeTarget) => (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(target);
    startXRef.current = e.clientX;
    startWidthRef.current = target === 'left' ? sidebarWidth : rightPanelWidth;
  }, [sidebarWidth, rightPanelWidth]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return;

    const delta = e.clientX - startXRef.current;

    if (isResizing === 'left') {
      const newWidth = Math.min(
        LEFT_SIDEBAR_MAX,
        Math.max(LEFT_SIDEBAR_MIN, startWidthRef.current + delta)
      );
      setSidebarWidth(newWidth);
    } else if (isResizing === 'right') {
      // For right panel, dragging left increases width
      const newWidth = Math.min(
        RIGHT_PANEL_MAX,
        Math.max(RIGHT_PANEL_MIN, startWidthRef.current - delta)
      );
      setRightPanelWidth(newWidth);
    }
  }, [isResizing, setSidebarWidth, setRightPanelWidth]);

  const handleMouseUp = useCallback(() => {
    setIsResizing(null);
  }, []);

  // Global mouse event listeners for smooth dragging
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Prevent text selection while dragging
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isResizing, handleMouseMove, handleMouseUp]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-gray-900">
      {/* Left Sidebar */}
      <div
        className="flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-sidebar-light dark:bg-sidebar-dark relative"
        style={{ width: `${sidebarWidth}px` }}
      >
        <Sidebar />

        {/* Left Resize Handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 transition-colors duration-150
            ${isResizing === 'left'
              ? 'bg-blue-500'
              : isHovering === 'left'
                ? 'bg-gray-300 dark:bg-gray-600'
                : 'bg-transparent'
            }`}
          onMouseDown={handleMouseDown('left')}
          onMouseEnter={() => setIsHovering('left')}
          onMouseLeave={() => setIsHovering(null)}
        />

        {/* Extended hit area for easier grabbing */}
        <div
          className="absolute top-0 right-0 w-2 h-full cursor-col-resize z-10"
          style={{ transform: 'translateX(50%)' }}
          onMouseDown={handleMouseDown('left')}
          onMouseEnter={() => setIsHovering('left')}
          onMouseLeave={() => setIsHovering(null)}
        />
      </div>

      {/* Center Editor */}
      <div className="flex-1 flex flex-col min-w-0 bg-editor-light dark:bg-editor-dark">
        <Editor />
      </div>

      {/* Right Panel */}
      <div
        className="flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-panel-light dark:bg-panel-dark relative"
        style={{ width: `${rightPanelWidth}px` }}
      >
        {/* Right Resize Handle */}
        <div
          className={`absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 transition-colors duration-150
            ${isResizing === 'right'
              ? 'bg-blue-500'
              : isHovering === 'right'
                ? 'bg-gray-300 dark:bg-gray-600'
                : 'bg-transparent'
            }`}
          onMouseDown={handleMouseDown('right')}
          onMouseEnter={() => setIsHovering('right')}
          onMouseLeave={() => setIsHovering(null)}
        />

        {/* Extended hit area for easier grabbing */}
        <div
          className="absolute top-0 left-0 w-2 h-full cursor-col-resize z-10"
          style={{ transform: 'translateX(-50%)' }}
          onMouseDown={handleMouseDown('right')}
          onMouseEnter={() => setIsHovering('right')}
          onMouseLeave={() => setIsHovering(null)}
        />

        <RightPanel />
      </div>
    </div>
  );
}
