import { supabase } from '../supabase'
import { demoExpansion } from './demo'
import { connectedExpansion } from './real'

export const expansion = supabase ? connectedExpansion() : demoExpansion
