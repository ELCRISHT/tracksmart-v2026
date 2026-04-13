-- TrackSmart Supabase Schema

-- Users table (extends Supabase auth)
CREATE TABLE public.users (
  id UUID REFERENCES auth.users NOT NULL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'student' CHECK (role IN ('teacher', 'student', 'admin')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Sessions table
CREATE TABLE public.sessions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  teacher_id UUID REFERENCES public.users(id) NOT NULL,
  room_code VARCHAR(6) UNIQUE NOT NULL,
  title TEXT NOT NULL,
  status TEXT DEFAULT 'waiting' CHECK (status IN ('waiting', 'live', 'ended')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE
);

-- Participants table (Students and Teachers)
CREATE TABLE public.participants (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  display_name TEXT NOT NULL,
  student_token TEXT, -- Optional, used for guest tracking
  joined_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  left_at TIMESTAMP WITH TIME ZONE,
  attention_score FLOAT DEFAULT 100 CHECK (attention_score >= 0 AND attention_score <= 100)
);

-- Session events log (for reporting and ML analysis)
CREATE TABLE public.session_events (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE NOT NULL,
  student_id UUID, -- Optional: could be anonymous or linked to participants.id
  event_type TEXT NOT NULL, -- 'distraction', 'phone_detected', 'tab_switch', 'attention_update'
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Row Level Security (RLS) Policies

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_events ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own profile
CREATE POLICY "Users can view own profile" 
ON public.users FOR SELECT 
USING (auth.uid() = id);

-- Teachers can view all sessions they created
CREATE POLICY "Teachers can view own sessions" 
ON public.sessions FOR SELECT 
USING (auth.uid() = teacher_id);

-- Anyone can view a session if they have the code (useful for validation)
CREATE POLICY "Anyone can view session by code" 
ON public.sessions FOR SELECT 
USING (true);

-- Teachers can insert sessions
CREATE POLICY "Teachers can create sessions" 
ON public.sessions FOR INSERT 
WITH CHECK (auth.uid() = teacher_id);

-- Teachers can update their own sessions
CREATE POLICY "Teachers can update own sessions" 
ON public.sessions FOR UPDATE 
USING (auth.uid() = teacher_id);

-- Realtime subscriptions
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.participants;
