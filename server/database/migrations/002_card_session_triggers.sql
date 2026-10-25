-- Install AFTER historical rows have been loaded, avoiding duplicate historical sessions.
CREATE FUNCTION shop.assign_card_usage_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, shop AS $shop_function$
BEGIN
  IF NEW.action = 'assign' THEN
    INSERT INTO shop.card_usage_sessions
      (card_number, member_number, started_at, opened_by, opening_balance)
    SELECT NEW.card_number, NEW.member_number, NEW.created_at, NEW.actor,
      CASE WHEN EXISTS (SELECT 1 FROM shop.member_transactions WHERE member_number = NEW.member_number)
      THEN balance ELSE 0 END
    FROM shop.members WHERE member_number = NEW.member_number;
  ELSE
    UPDATE shop.card_usage_sessions
      SET ended_at = NEW.created_at, closed_by = NEW.actor, end_reason = NEW.action,
          closing_balance = (SELECT balance FROM shop.members WHERE member_number = NEW.member_number)
      WHERE card_number = NEW.card_number AND member_number = NEW.member_number AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$shop_function$;
CREATE TRIGGER card_session_assignment AFTER INSERT ON shop.card_assignments
FOR EACH ROW EXECUTE FUNCTION shop.assign_card_usage_session();

CREATE FUNCTION shop.attach_card_usage_session() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, shop AS $shop_function$
BEGIN
  IF NEW.card_usage_session_id IS NULL THEN
    SELECT id INTO NEW.card_usage_session_id FROM shop.card_usage_sessions
      WHERE member_number = NEW.member_number AND ended_at IS NULL;
  END IF;
  RETURN NEW;
END;
$shop_function$;
CREATE TRIGGER member_tx_card_session BEFORE INSERT ON shop.member_transactions
FOR EACH ROW EXECUTE FUNCTION shop.attach_card_usage_session();
CREATE TRIGGER sale_card_session BEFORE INSERT ON shop.sales
FOR EACH ROW EXECUTE FUNCTION shop.attach_card_usage_session();
