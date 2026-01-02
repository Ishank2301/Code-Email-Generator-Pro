
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  GoogleGenAI, 
  Modality, 
  Type, 
  GenerateContentResponse,
  LiveServerMessage
} from "@google/genai";
import { 
  Send, 
  Image as ImageIcon, 
  Mic, 
  MicOff, 
  Sparkles, 
  Search, 
  Info, 
  Cpu, 
  Maximize2, 
  Plus, 
  History,
  Terminal,
  RefreshCcw,
  Zap,
  Github
} from "lucide-react";

// --- Types ---
type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  thinking?: string;
  groundingUrls?: { uri: string; title: string }[];
};

type GeneratedImage = {
  id: string;
  url: string;
  prompt: string;
  timestamp: Date;
};

// --- Utils ---
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// --- Components ---

const App = () => {
  const [activeTab, setActiveTab] = useState<'chat' | 'image' | 'voice'>('chat');
  const [apiKeyValid] = useState(true); // process.env.API_KEY is assumed to be valid

  return (
    <div className="min-h-screen flex flex-col max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <header className="flex items-center justify-between mb-8 pb-6 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight gradient-text">Lumina Studio</h1>
            <p className="text-xs text-gray-400 font-medium">Gemini 3 Pro Powered</p>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-1 p-1 rounded-2xl glass">
          <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={<Terminal size={18}/>} label="Thought Lab" />
          <TabButton active={activeTab === 'image'} onClick={() => setActiveTab('image')} icon={<ImageIcon size={18}/>} label="Canvas" />
          <TabButton active={activeTab === 'voice'} onClick={() => setActiveTab('voice')} icon={<Mic size={18}/>} label="Echo" />
        </nav>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            System Ready
          </div>
          <button className="p-2 rounded-full hover:bg-gray-800 transition-colors text-gray-400">
            <Github size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        {activeTab === 'chat' && <ChatModule />}
        {activeTab === 'image' && <ImageModule />}
        {activeTab === 'voice' && <VoiceModule />}
      </main>

      {/* Mobile Nav */}
      <nav className="md:hidden fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 rounded-2xl glass shadow-2xl z-50">
        <TabButton active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} icon={<Terminal size={18}/>} label="Chat" />
        <TabButton active={activeTab === 'image'} onClick={() => setActiveTab('image')} icon={<ImageIcon size={18}/>} label="Canvas" />
        <TabButton active={activeTab === 'voice'} onClick={() => setActiveTab('voice')} icon={<Mic size={18}/>} label="Echo" />
      </nav>
    </div>
  );
};

const TabButton = ({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) => (
  <button 
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all duration-300 ${
      active 
      ? 'bg-indigo-600/20 text-indigo-300 shadow-inner' 
      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
    }`}
  >
    {icon}
    <span className="text-sm font-semibold">{label}</span>
  </button>
);

const ChatModule = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [useSearch, setUseSearch] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: [...messages.map(m => ({
          role: m.role === 'user' ? 'user' : 'model' as any,
          parts: [{ text: m.content }]
        })), { role: 'user', parts: [{ text: input }] }],
        config: {
          thinkingConfig: { thinkingBudget: 16000 },
          tools: useSearch ? [{ googleSearch: {} }] : []
        }
      });

      const text = response.text || "I couldn't generate a response.";
      const groundingChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
      const urls = groundingChunks?.map((chunk: any) => chunk.web).filter(Boolean);

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: text,
        timestamp: new Date(),
        groundingUrls: urls
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (err) {
      console.error(err);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'assistant',
        content: "Error connecting to the cortex. Please check your connectivity.",
        timestamp: new Date()
      }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="h-[calc(100vh-180px)] flex flex-col glass rounded-3xl overflow-hidden shadow-2xl">
      <div className="px-6 py-4 border-b border-gray-800 flex justify-between items-center bg-white/5">
        <div className="flex items-center gap-3">
          <Terminal size={18} className="text-indigo-400" />
          <h2 className="font-semibold text-gray-200">Neural Chat Lab</h2>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setUseSearch(!useSearch)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              useSearch ? 'bg-indigo-600/20 text-indigo-400 border border-indigo-500/30' : 'bg-gray-800 text-gray-500'
            }`}
          >
            <Search size={14} />
            Search Grounding: {useSearch ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => setMessages([])} className="text-gray-500 hover:text-white transition-colors">
            <RefreshCcw size={16} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-6 scroll-smooth">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20">
            <div className="w-16 h-16 rounded-full bg-indigo-500/10 flex items-center justify-center mb-4">
              <Cpu size={32} className="text-indigo-400" />
            </div>
            <p className="text-xl font-medium text-gray-300">Awaiting input signals...</p>
            <p className="text-sm max-w-xs mt-2 text-gray-400">Gemini 3 Pro is ready for complex reasoning, coding, and creative writing.</p>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-lg ${
              m.role === 'user' 
              ? 'bg-indigo-600 text-white rounded-tr-none' 
              : 'bg-gray-800/80 text-gray-200 border border-gray-700/50 rounded-tl-none'
            }`}>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</div>
              
              {m.groundingUrls && m.groundingUrls.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-700/50">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">Sources:</p>
                  <div className="flex flex-wrap gap-2">
                    {m.groundingUrls.map((link, idx) => (
                      <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" 
                         className="text-xs bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 px-2 py-1 rounded transition-colors flex items-center gap-1">
                        <Maximize2 size={10} />
                        {link.title || 'Source'}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              
              <div className={`text-[10px] mt-2 opacity-40 font-mono ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-gray-800/80 border border-gray-700/50 px-5 py-3 rounded-2xl rounded-tl-none">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></span>
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
              <p className="text-[10px] text-indigo-400 mt-2 font-bold uppercase tracking-widest animate-pulse">Neural processing...</p>
            </div>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="p-4 bg-black/20 border-t border-gray-800">
        <div className="relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a prompt for the model..."
            className="w-full bg-gray-900 border border-gray-800 text-gray-200 pl-5 pr-14 py-4 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all shadow-inner"
          />
          <button 
            type="submit"
            disabled={!input.trim() || isTyping}
            className="absolute right-2.5 p-2.5 rounded-xl bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-600/20"
          >
            <Send size={20} />
          </button>
        </div>
      </form>
    </div>
  );
};

const ImageModule = () => {
  const [prompt, setPrompt] = useState('');
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [aspectRatio, setAspectRatio] = useState('1:1');

  const generateImage = async () => {
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: prompt }]
        },
        config: {
          imageConfig: { aspectRatio: aspectRatio as any }
        }
      });

      let imageUrl = '';
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (imageUrl) {
        setImages(prev => [{
          id: Date.now().toString(),
          url: imageUrl,
          prompt,
          timestamp: new Date()
        }, ...prev]);
        setPrompt('');
      }
    } catch (err) {
      console.error(err);
      alert("Imaging failure. The creative engine encountered an error.");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-[calc(100vh-180px)] flex flex-col md:flex-row gap-6">
      <div className="md:w-1/3 glass rounded-3xl p-6 flex flex-col border border-gray-800 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <ImageIcon size={22} className="text-indigo-400" />
          <h2 className="text-xl font-bold text-white">Visual Synthesis</h2>
        </div>
        
        <div className="space-y-6 flex-1">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Prompt Concept</label>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A futuristic city with floating gardens and purple skylines..."
              className="w-full h-32 bg-gray-900 border border-gray-800 text-gray-200 p-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-none transition-all"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Aspect Ratio</label>
            <div className="grid grid-cols-3 gap-2">
              {['1:1', '4:3', '16:9'].map(ratio => (
                <button 
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={`py-2 rounded-lg text-xs font-bold transition-all border ${
                    aspectRatio === ratio 
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400 shadow-lg shadow-indigo-500/10' 
                    : 'bg-gray-800 border-gray-700 text-gray-500'
                  }`}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button 
          onClick={generateImage}
          disabled={!prompt.trim() || isGenerating}
          className="w-full mt-6 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:from-indigo-500 hover:to-violet-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-indigo-600/20 group"
        >
          {isGenerating ? (
            <>
              <RefreshCcw className="animate-spin" size={18} />
              Rendering...
            </>
          ) : (
            <>
              <Zap size={18} className="group-hover:animate-pulse" />
              Synthesize Image
            </>
          )}
        </button>
      </div>

      <div className="flex-1 glass rounded-3xl p-6 overflow-y-auto border border-gray-800 shadow-xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <History size={18} className="text-gray-500" />
            <h2 className="font-semibold text-gray-400">Generation Gallery</h2>
          </div>
          <span className="text-xs text-gray-600 font-mono">{images.length} iterations</span>
        </div>

        {images.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
            <Plus size={48} />
            <p className="mt-4 font-medium italic">Gallery empty. Start creating.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {images.map(img => (
              <div key={img.id} className="group relative overflow-hidden rounded-2xl bg-gray-900 border border-gray-800 aspect-square">
                <img src={img.url} alt={img.prompt} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-4">
                  <p className="text-white text-xs font-medium line-clamp-2 mb-2">{img.prompt}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-400 font-mono">{img.timestamp.toLocaleTimeString()}</span>
                    <button className="p-2 bg-white/10 rounded-lg hover:bg-white/20 text-white">
                      <Maximize2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const VoiceModule = () => {
  const [isActive, setIsActive] = useState(false);
  const [transcriptions, setTranscriptions] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const sessionRef = useRef<any>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const stopConversation = useCallback(() => {
    setIsActive(false);
    if (sessionRef.current) {
      sessionRef.current.close?.();
      sessionRef.current = null;
    }
    sourcesRef.current.forEach(s => s.stop());
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
  }, []);

  const startConversation = async () => {
    try {
      setIsActive(true);
      setError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextRef.current = outputCtx;

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              const base64 = encode(new Uint8Array(int16.buffer));
              
              sessionPromise.then(session => {
                session.sendRealtimeInput({ 
                  media: { data: base64, mimeType: 'audio/pcm;rate=16000' } 
                });
              });
            };

            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              setTranscriptions(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'ai') {
                  return [...prev.slice(0, -1), { role: 'ai', text: last.text + text }];
                }
                return [...prev, { role: 'ai', text }];
              });
            } else if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
               setTranscriptions(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'user') {
                  return [...prev.slice(0, -1), { role: 'user', text: last.text + text }];
                }
                return [...prev, { role: 'user', text }];
              });
            }

            const base64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64 && outputCtx) {
              const audioBuffer = await decodeAudioData(decode(base64), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(outputCtx.destination);
              
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              
              sourcesRef.current.add(source);
              source.onended = () => sourcesRef.current.delete(source);
            }

            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => s.stop());
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error('Live error:', e);
            setError("Connection disrupted. Please retry.");
            stopConversation();
          },
          onclose: () => {
            console.debug('Session closed');
            setIsActive(false);
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
          inputAudioTranscription: {},
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } }
          },
          systemInstruction: 'You are Lumina, a brilliant and empathetic voice assistant. Keep responses conversational and naturally paced.'
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setError("Microphone access denied or connection failed.");
      setIsActive(false);
    }
  };

  return (
    <div className="h-[calc(100vh-180px)] flex flex-col items-center justify-center p-6 glass rounded-3xl border border-gray-800 shadow-2xl relative overflow-hidden">
      {/* Background Ambience */}
      <div className={`absolute inset-0 bg-indigo-600/5 transition-opacity duration-1000 ${isActive ? 'opacity-100' : 'opacity-0'}`}>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/20 rounded-full blur-[100px] animate-pulse"></div>
      </div>

      <div className="z-10 text-center space-y-8 w-full max-w-2xl">
        <div className="relative inline-block">
          <div className={`absolute -inset-4 bg-indigo-500/20 rounded-full blur-xl transition-all duration-700 ${isActive ? 'opacity-100 scale-150' : 'opacity-0 scale-50'}`}></div>
          <button 
            onClick={isActive ? stopConversation : startConversation}
            className={`relative w-24 h-24 rounded-full flex items-center justify-center transition-all duration-500 shadow-2xl ${
              isActive 
              ? 'bg-red-500 hover:bg-red-600 scale-110' 
              : 'bg-indigo-600 hover:bg-indigo-500'
            }`}
          >
            {isActive ? <MicOff size={32} className="text-white" /> : <Mic size={32} className="text-white" />}
          </button>
        </div>

        <div>
          <h2 className="text-3xl font-bold mb-2">{isActive ? 'Lumina is Listening' : 'Echo Voice Companion'}</h2>
          <p className="text-gray-400 max-w-md mx-auto">
            {isActive 
              ? "Speak naturally. Our low-latency native audio engine responds in real-time." 
              : "Experience a natural conversation with Gemini's high-fidelity voice model."}
          </p>
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl">
            {error}
          </div>
        )}

        <div className="h-64 overflow-y-auto space-y-4 px-4 mask-fade">
          {transcriptions.map((t, i) => (
            <div key={i} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className={`text-[10px] uppercase font-bold tracking-widest mb-1 ${t.role === 'user' ? 'text-indigo-400' : 'text-gray-500'}`}>
                {t.role === 'user' ? 'Input' : 'Lumina'}
              </span>
              <p className={`px-4 py-2 rounded-2xl text-sm ${
                t.role === 'user' 
                ? 'bg-indigo-600/10 border border-indigo-500/20 text-indigo-300' 
                : 'text-gray-200'
              }`}>
                {t.text}
              </p>
            </div>
          ))}
          {isActive && transcriptions.length === 0 && (
            <div className="flex justify-center gap-2">
              <div className="w-1 h-4 bg-indigo-500/50 rounded-full animate-[pulse_1s_infinite]"></div>
              <div className="w-1 h-6 bg-indigo-500 rounded-full animate-[pulse_1.2s_infinite]"></div>
              <div className="w-1 h-4 bg-indigo-500/50 rounded-full animate-[pulse_1s_infinite]"></div>
            </div>
          )}
        </div>
      </div>

      <div className="absolute bottom-8 right-8 flex items-center gap-3 text-xs text-gray-500 font-medium">
        <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-indigo-500 animate-pulse' : 'bg-gray-700'}`}></div>
        Live Native Audio Engine
      </div>
    </div>
  );
};

// --- Initial Render ---
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
