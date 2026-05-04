import streamlit as st
from data_sources import FakeDataSource
st.set_page_config(page_title="ICT Trading Dashboard", layout="wide")
st.sidebar.title("ICT Dashboard")
ds = FakeDataSource()
st.title("🏠 ICT Trading Dashboard")
overview = ds.get_home_overview()
col1, col2, col3, col4 = st.columns(4)
col1.metric("24h PnL", f"${overview['pnl_24h']:.2f}")
col2.metric("Open Trades", overview["open_trades"])
col3.metric("VM CPU", f"{overview['vm_health']['cpu']:.1f}%")
col4.metric("Status", overview["trader_status"])
