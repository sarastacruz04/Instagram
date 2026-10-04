import type { ActivityItem } from '@/domain/entities/Post';
import { AppError } from '@/domain/errors';
import type { ActivityRepository } from '@/domain/repositories/PostRepository';

import { toActivity, type ActivityRow } from '../mappers/postMapper';
import { supabase } from '../remote/supabaseClient';

export class SupabaseActivityRepository implements ActivityRepository {
  async getActivity(): Promise<ActivityItem[]> {
    const { data, error } = await supabase.rpc('get_activity', { p_limit: 50 });
    if (error) throw new AppError(error.message);
    return ((data ?? []) as ActivityRow[]).map(toActivity);
  }
}
