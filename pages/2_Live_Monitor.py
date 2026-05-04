import streamlit as st
import plotly.graph_objects as go
from data_sources import FakeDataSource
st.set_page_config(page_title="Live Monitor", layout="wide")
ds = FakeDataSource()
st.title("📊 Live Trader Monitor")
df_ticks = ds.get_live_ticks()
fig = go.Figure(data=[go.Candlestick(x=df_ticks["time"], open=df_ticks["open"], 
                                     high=df_ticks["high"], low=df_ticks["low"], close=df_ticks["close"])])
st.plotly_chart(fig, use_container_width=True)
st.subheader("Recent Ticks")
st.dataframe(df_ticks.tail())
