export interface Candidate {
  id: string;
  question: string;
  answer: string;
  confidence: number;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  id?: string;
  intent?: string;
  intentLevel2?: string | null;
  confidence?: number;
  query?: string;
  fallback?: boolean;
}

export interface WebSocketMessage {
  type: 'init' | 'message' | 'history' | 'typing' | 'intent' | 'error' | 'candidates' | 'stream' | 'stream_end';
  sessionId?: string;
  content?: string;
  messages?: Message[];
  status?: boolean;
  intent?: string;
  intentLevel2?: string | null;
  confidence?: number;
  messageId?: string;
  query?: string;
  timestamp?: string;
  candidates?: Candidate[];
  originalMessage?: string;
  fallback?: boolean;
}
