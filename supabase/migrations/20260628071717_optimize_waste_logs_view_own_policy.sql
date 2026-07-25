alter policy "Users can view own logs"
  on public.waste_logs
  using (((select auth.uid()) = user_id));
