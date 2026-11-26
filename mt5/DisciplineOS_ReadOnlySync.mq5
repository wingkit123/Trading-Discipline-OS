//+------------------------------------------------------------------+
//|                                   DisciplineOS_ReadOnlySync.mq5  |
//|         Strictly Read-Only MT5 Service for Trading Discipline OS |
//|   ZERO OrderSend / CTrade / DLLs. Safe for Investor/View-Only.   |
//+------------------------------------------------------------------+
#property service
#property copyright "Personal Trading Discipline OS"
#property version   "1.00"
#property strict

input int    PollIntervalSeconds = 10;
input int    LookbackDays        = 90;
input string OutputFileName      = "discipline-os-sync.json";

string EscapeJson(const string src)
{
   string out = "";
   int len = StringLen(src);
   for(int i = 0; i < len; i++)
   {
      ushort ch = StringGetCharacter(src, i);
      if(ch == '"')       out += "\\\"";
      else if(ch == '\\') out += "\\\\";
      else if(ch == '\n') out += "\\n";
      else if(ch == '\r') out += "\\r";
      else if(ch == '\t') out += "\\t";
      else if(ch < 32)    out += " ";
      else                out += ShortToString(ch);
   }
   return out;
}

string FormatIsoUtc(const datetime utcTime)
{
   MqlDateTime dt;
   TimeToStruct(utcTime, dt);
   return StringFormat("%04d-%02d-%02dT%02d:%02d:%02dZ",
                       dt.year, dt.mon, dt.day, dt.hour, dt.min, dt.sec);
}

string DealTypeToSide(const long dealType)
{
   if(dealType == DEAL_TYPE_BUY)     return "buy";
   if(dealType == DEAL_TYPE_SELL)    return "sell";
   if(dealType == DEAL_TYPE_BALANCE) return "balance";
   if(dealType == DEAL_TYPE_CREDIT)  return "credit";
   return "other";
}

string DealEntryToKind(const long dealEntry)
{
   if(dealEntry == DEAL_ENTRY_IN)    return "in";
   if(dealEntry == DEAL_ENTRY_OUT)   return "out";
   if(dealEntry == DEAL_ENTRY_INOUT) return "inout";
   return "other";
}

string BuildSyncJson(const long serverToGmtOffset)
{
   string login   = IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN));
   string broker  = EscapeJson(AccountInfoString(ACCOUNT_COMPANY));
   string curr    = EscapeJson(AccountInfoString(ACCOUNT_CURRENCY));
   bool   allowed = (bool)AccountInfoInteger(ACCOUNT_TRADE_ALLOWED);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   double equity  = AccountInfoDouble(ACCOUNT_EQUITY);
   int    openCnt = PositionsTotal();

   string json = "{\n";
   json += "  \"schema\": \"tdos-mt5-sync.v1\",\n";
   json += "  \"exported_at_utc\": \"" + FormatIsoUtc(TimeGMT()) + "\",\n";
   json += "  \"account_login\": \"" + login + "\",\n";
   json += "  \"broker\": \"" + broker + "\",\n";
   json += "  \"currency\": \"" + curr + "\",\n";
   json += "  \"trade_allowed\": " + (allowed ? "true" : "false") + ",\n";
   json += "  \"balance\": " + DoubleToString(balance, 2) + ",\n";
   json += "  \"equity\": " + DoubleToString(equity, 2) + ",\n";
   json += "  \"open_positions_count\": " + IntegerToString(openCnt) + ",\n";
   json += "  \"deals\": [\n";

   int total = HistoryDealsTotal();
   bool first = true;
   for(int i = 0; i < total; i++)
   {
      ulong ticket = HistoryDealGetTicket(i);
      if(ticket == 0) continue;

      long dealType  = HistoryDealGetInteger(ticket, DEAL_TYPE);
      long dealEntry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
      string side    = DealTypeToSide(dealType);
      if(side == "other") continue;

      long posId      = HistoryDealGetInteger(ticket, DEAL_POSITION_ID);
      string symbol   = EscapeJson(HistoryDealGetString(ticket, DEAL_SYMBOL));
      string entryStr = (side == "balance" || side == "credit") ? "balance" : DealEntryToKind(dealEntry);
      double volume   = HistoryDealGetDouble(ticket, DEAL_VOLUME);
      double price    = HistoryDealGetDouble(ticket, DEAL_PRICE);
      double profit   = HistoryDealGetDouble(ticket, DEAL_PROFIT);
      double comm     = HistoryDealGetDouble(ticket, DEAL_COMMISSION);
      double swap     = HistoryDealGetDouble(ticket, DEAL_SWAP);
      double fee      = HistoryDealGetDouble(ticket, DEAL_FEE);
      datetime dTime  = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      datetime dUtc   = (datetime)(dTime - serverToGmtOffset);
      string comment  = EscapeJson(HistoryDealGetString(ticket, DEAL_COMMENT));

      if(!first) json += ",\n";
      first = false;

      json += "    {";
      json += "\"deal_ticket\":\"" + StringFormat("%I64u", ticket) + "\",";
      json += "\"position_id\":\"" + IntegerToString(posId) + "\",";
      json += "\"symbol\":\"" + symbol + "\",";
      json += "\"side\":\"" + side + "\",";
      json += "\"entry_kind\":\"" + entryStr + "\",";
      json += "\"volume\":" + DoubleToString(volume, 2) + ",";
      json += "\"price\":" + DoubleToString(price, 5) + ",";
      json += "\"profit\":" + DoubleToString(profit, 2) + ",";
      json += "\"commission\":" + DoubleToString(comm, 2) + ",";
      json += "\"swap\":" + DoubleToString(swap, 2) + ",";
      json += "\"fee\":" + DoubleToString(fee, 2) + ",";
      json += "\"deal_time_utc\":\"" + FormatIsoUtc(dUtc) + "\",";
      json += "\"comment\":\"" + comment + "\"";
      json += "}";
   }

   json += "\n  ]\n}\n";
   return json;
}

bool WriteAtomic(const string filename, const string payload)
{
   string tmp = filename + ".tmp";
   int handle = FileOpen(tmp, FILE_WRITE | FILE_TXT | FILE_ANSI);
   if(handle == INVALID_HANDLE) return false;
   FileWriteString(handle, payload);
   FileClose(handle);
   return FileMove(tmp, 0, filename, FILE_REWRITE);
}

void OnStart()
{
   string lastFingerprint = "";
   int pollSec = MathMax(3, PollIntervalSeconds);

   while(!IsStopped())
   {
      datetime nowSrv = TimeCurrent();
      datetime nowGmt = TimeGMT();
      long offset = (long)(nowSrv - nowGmt);
      datetime fromTime = nowSrv - (datetime)((long)MathMax(1, LookbackDays) * 86400);

      if(HistorySelect(fromTime, nowSrv + 86400))
      {
         int total = HistoryDealsTotal();
         ulong lastTicket = total > 0 ? HistoryDealGetTicket(total - 1) : 0;
         string fp = IntegerToString(total) + "|" +
                     StringFormat("%I64u", lastTicket) + "|" +
                     DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2) + "|" +
                     DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + "|" +
                     IntegerToString(PositionsTotal());

         if(fp != lastFingerprint)
         {
            string json = BuildSyncJson(offset);
            if(WriteAtomic(OutputFileName, json))
               lastFingerprint = fp;
         }
      }

      int chunks = pollSec * 2;
      for(int c = 0; c < chunks && !IsStopped(); c++)
         Sleep(500);
   }
}
//+------------------------------------------------------------------+
