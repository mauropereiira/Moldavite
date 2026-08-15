import React, { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { Sidebar } from '../sidebar/Sidebar';
import { Editor } from '../editor/Editor';
import { RightPanel } from './RightPanel';
import { IndexOverlay } from '@/components/index-overlay/IndexOverlay';
import { AgendaOverlay } from '@/components/agenda-overlay/AgendaOverlay';
import { EditorNavigation } from './EditorNavigation';
import { IconRail } from './IconRail';
import { useOverlayStore, useSettingsStore, useTimelineStore } from '@/stores';

// TimelineView pulls in calendar/event aggregation + its own render
// pipeline — only load it when the user actually toggles the timeline on.
const TimelineView = lazy(() => import('../timeline').then((m) => ({ default: m.TimelineView })));

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
    showIconRail,
    indexMode,
    agendaMode,
    setSidebarWidth,
    setRightPanelWidth,
  } = useSettingsStore();
  const isTimelineOpen = useTimelineStore((s) => s.isOpen);
  const { activeOverlay, isSidebarHidden, isRightPanelHidden, closeOverlay } = useOverlayStore();

  const [isResizing, setIsResizing] = useState<ResizeTarget>(null);
  const [isHovering, setIsHovering] = useState<ResizeTarget>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleMouseDown = useCallback(
    (target: ResizeTarget) => (e: React.MouseEvent) => {
      e.preventDefault();
      setIsResizing(target);
      startXRef.current = e.clientX;
      startWidthRef.current = target === 'left' ? sidebarWidth : rightPanelWidth;
    },
    [sidebarWidth, rightPanelWidth]
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
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
    },
    [isResizing, setSidebarWidth, setRightPanelWidth]
  );

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

  useEffect(() => {
    if (
      (activeOverlay === 'index' && indexMode !== 'overlay') ||
      (activeOverlay === 'agenda' && agendaMode !== 'overlay')
    ) {
      closeOverlay();
    }
  }, [activeOverlay, agendaMode, closeOverlay, indexMode]);

  const sidebarVisible = indexMode === 'pinned' && !isSidebarHidden;
  const rightPanelVisible = agendaMode === 'pinned' && !isRightPanelHidden;

  // Publish the rail's presence so full-window surfaces outside this tree —
  // the graph is mounted at the App root, not inside the content area — can
  // start clear of it. See `--rail-width` in index.css.
  useEffect(() => {
    document.documentElement.classList.toggle('has-icon-rail', showIconRail);
    return () => document.documentElement.classList.remove('has-icon-rail');
  }, [showIconRail]);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ backgroundColor: 'var(--bg-base)' }}
    >
      {showIconRail && <IconRail />}

      <div
        data-testid="app-content-area"
        className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {/* Left Sidebar */}
        {sidebarVisible && (
          <div
            className="app-sidebar flex-shrink-0 relative"
            style={{
              width: `${sidebarWidth}px`,
              backgroundColor: 'var(--bg-sidebar)',
              borderRight: '1px solid var(--border-default)',
            }}
          >
            <Sidebar />

            {/* Left Resize Handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize z-10 transition-colors"
              style={{
                transitionDuration: 'var(--duration-fast)',
                backgroundColor:
                  isResizing === 'left'
                    ? 'var(--accent-primary)'
                    : isHovering === 'left'
                      ? 'var(--border-strong)'
                      : 'transparent',
              }}
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
        )}

        {/* Center pane — Editor by default, Timeline when toggled on */}
        <div
          className="relative flex-1 flex flex-col min-w-0"
          style={{ backgroundColor: 'var(--bg-editor)' }}
        >
          {isTimelineOpen ? (
            <Suspense fallback={null}>
              <TimelineView />
            </Suspense>
          ) : (
            <>
              <Editor />
              <EditorNavigation />
            </>
          )}
        </div>

        {/* Right Panel */}
        {rightPanelVisible && (
          <div
            className="app-right-panel relative min-h-0 flex-shrink-0 overflow-hidden"
            style={{
              width: `${rightPanelWidth}px`,
              backgroundColor: 'var(--bg-panel)',
              borderLeft: '1px solid var(--border-default)',
            }}
          >
            {/* Right Resize Handle */}
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize z-10 transition-colors"
              style={{
                transitionDuration: 'var(--duration-fast)',
                backgroundColor:
                  isResizing === 'right'
                    ? 'var(--accent-primary)'
                    : isHovering === 'right'
                      ? 'var(--border-strong)'
                      : 'transparent',
              }}
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
        )}

        <IndexOverlay
          isOpen={activeOverlay === 'index' && indexMode === 'overlay'}
          onClose={closeOverlay}
        />
        <AgendaOverlay
          isOpen={activeOverlay === 'agenda' && agendaMode === 'overlay'}
          onClose={closeOverlay}
        />
      </div>
    </div>
  );
}
