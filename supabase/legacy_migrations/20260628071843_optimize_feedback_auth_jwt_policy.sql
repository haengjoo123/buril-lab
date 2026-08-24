alter policy "Anyone can insert feedback"
  on public.feedback
  with check (
    (((select auth.uid()) is null) and (user_id is null) and (user_email is null))
    or (
      ((select auth.uid()) = user_id)
      and (
        (user_email is null)
        or (user_email = ((select auth.jwt()) ->> 'email'::text))
      )
    )
  );
