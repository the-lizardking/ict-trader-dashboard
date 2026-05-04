import streamlit as st
from data_sources import FakeDataSource
st.set_page_config(page_title="Home", layout="wide")
ds = FakeDataSource()
st.title("🏠 Quick Overview")
overview = ds.get_home_overview()
st.metric("24h PnL", f"${overview['pnl_24h']:.2f}")
st.metric("Open Trades", overview["open_trades"])
st.metric("VM CPU", f"{overview['vm_health']['cpu']:.1f}%")
st.metric("Status", overview["trader_status"])
with st.expander("Raw Data"):
    st.json(overview)
