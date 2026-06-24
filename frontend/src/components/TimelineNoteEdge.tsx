"use client";

import { motion } from "framer-motion";
import { TimelineNode, TimelineNote, TimelineNoteEdge } from "@/lib/types";
import { NODE_DIMENSIONS } from "@/lib/dummy-data";
import { TIMELINE_NOTE_DEFAULT_WIDTH, TIMELINE_NOTE_MIN_HEIGHT, noteColorStyle } from "@/lib/note-style";

interface TimelineNoteEdgeLineProps {
  note: TimelineNote;
  node: TimelineNode;
  edge: TimelineNoteEdge;
  index: number;
}

export function TimelineNoteEdgeLine({ note, node, edge, index }: TimelineNoteEdgeLineProps) {
  const noteWidth = note.width ?? TIMELINE_NOTE_DEFAULT_WIDTH;
  const noteHeight = note.height ?? TIMELINE_NOTE_MIN_HEIGHT;
  const colorStyle = noteColorStyle(note.color);

  const noteCenterX = note.x + noteWidth / 2;
  const noteCenterY = note.y + noteHeight / 2;
  const nodeCenterX = node.x + NODE_DIMENSIONS.width / 2;
  const nodeCenterY = node.y + NODE_DIMENSIONS.height / 2;
  const noteAnchorX = noteCenterX < nodeCenterX ? note.x + noteWidth : note.x;
  const nodeAnchorX = noteCenterX < nodeCenterX ? node.x : node.x + NODE_DIMENSIONS.width;
  const midX = (noteAnchorX + nodeAnchorX) / 2;
  const path = `M ${noteAnchorX} ${noteCenterY} C ${midX} ${noteCenterY}, ${midX} ${nodeCenterY}, ${nodeAnchorX} ${nodeCenterY}`;

  return (
    <g>
      <motion.path
        d={path}
        fill="none"
        stroke={colorStyle.accent}
        strokeWidth={1.35}
        strokeLinecap="round"
        strokeDasharray={edge.relation === "question" ? "5 4" : "2 5"}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.58 }}
        transition={{
          pathLength: {
            duration: 0.45,
            delay: index * 0.04,
            ease: [0.16, 1, 0.3, 1],
          },
          opacity: { duration: 0.2, delay: index * 0.04 },
        }}
      />
      <circle cx={nodeAnchorX} cy={nodeCenterY} r="3" fill={colorStyle.accent} opacity="0.72" />
    </g>
  );
}
