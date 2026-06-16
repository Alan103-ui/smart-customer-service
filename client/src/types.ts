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
  intent?: string;
  confidence?: number;
  fallback?: boolean;
}

export interface WebSocketMessage {
  type: 'init' | 'message' | 'history' | 'typing' | 'intent' | 'error' | 'satisfaction_ack' | 'candidates';
  sessionId?: string;
  content?: string;
  messages?: Message[];
  status?: boolean;
  intent?: string;
  confidence?: number;
  timestamp?: string;
  candidates?: Candidate[];
  originalMessage?: string;
  fallback?: boolean;
}
